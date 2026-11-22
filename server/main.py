"""Temporary multi-format upload and audio analysis API for VoiceBankStudio."""
from __future__ import annotations

import os
import tempfile
import wave
from pathlib import Path
from typing import Annotated

import av
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from voicebankstudio_audio import AudioAnalysisError, analyze_wav

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_DURATION_SECONDS = 180
OUTPUT_RATE = 22050
ALLOWED_EXTENSIONS = {
    ".wav", ".wave", ".mp3", ".flac", ".m4a", ".aac",
    ".aiff", ".aif", ".ogg", ".opus", ".wma",
}
ALLOWED_ORIGINS = ["https://zulizhiren85-dev.github.io"]

app = FastAPI(
    title="VoiceBankStudio Analysis API",
    version="0.2.0",
    description="Temporary multi-format audio upload, conversion to PCM WAV, and analysis.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/")
def root() -> dict:
    return {"service": "VoiceBankStudio Analysis API", "status": "ok"}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def convert_to_analysis_wav(source_path: str, output_path: str) -> float:
    """Decode a supported audio file and write mono 16-bit PCM WAV."""
    try:
        with av.open(source_path, mode="r") as container:
            audio_streams = [stream for stream in container.streams if stream.type == "audio"]
            if not audio_streams:
                raise ValueError("音声トラックが見つかりません。")
            stream = audio_streams[0]
            resampler = av.AudioResampler(format="s16", layout="mono", rate=OUTPUT_RATE)
            total_samples = 0
            with wave.open(output_path, "wb") as wav_out:
                wav_out.setnchannels(1)
                wav_out.setsampwidth(2)
                wav_out.setframerate(OUTPUT_RATE)

                def write_frames(frames) -> None:
                    nonlocal total_samples
                    for frame in frames:
                        # s16 + mono is packed PCM; read the PyAV plane directly so NumPy is not required.
                        pcm_bytes = frame.planes[0].to_bytes()
                        sample_count = len(pcm_bytes) // 2
                        total_samples += sample_count
                        if total_samples > MAX_DURATION_SECONDS * OUTPUT_RATE:
                            raise OverflowError("音源は3分以内にしてください。")
                        wav_out.writeframesraw(pcm_bytes)

                for decoded_frame in container.decode(stream):
                    write_frames(resampler.resample(decoded_frame))
                write_frames(resampler.resample(None))
            if total_samples == 0:
                raise ValueError("音声データを読み取れませんでした。")
            return total_samples / OUTPUT_RATE
    except OverflowError:
        raise
    except Exception as exc:
        raise ValueError("音声形式を読み取れませんでした。対応形式の音源か確認してください。") from exc


@app.post("/analyze")
async def analyze(file: Annotated[UploadFile, File(...)]) -> dict:
    original_name = Path(file.filename or "audio").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="対応形式は WAV / MP3 / FLAC / M4A / AAC / AIFF / OGG / OPUS / WMA です。",
        )

    source_path: str | None = None
    wav_path: str | None = None
    total = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="vbs-in-", suffix=suffix, delete=False) as temp:
            source_path = temp.name
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="音源は25MB以下にしてください。")
                temp.write(chunk)

        if total == 0:
            raise HTTPException(status_code=400, detail="ファイルが空です。")

        with tempfile.NamedTemporaryFile(prefix="vbs-converted-", suffix=".wav", delete=False) as temp_wav:
            wav_path = temp_wav.name

        try:
            duration = await __import__("asyncio").to_thread(convert_to_analysis_wav, source_path, wav_path)
        except OverflowError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        result = await __import__("asyncio").to_thread(analyze_wav, wav_path)
        result["duration_seconds"] = round(duration, 3)
        result["file_name"] = original_name
        result["upload_bytes"] = total
        result["converted_for_analysis"] = True
        result["analysis_format"] = "WAV PCM 16-bit mono 22050 Hz"
        result["temporary_upload"] = True
        result["server_storage"] = "deleted_after_response"
        return result
    except AudioAnalysisError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()
        for path in (source_path, wav_path):
            if path:
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass
