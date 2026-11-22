"""Temporary-upload API for VoiceBankStudio audio analysis."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from voicebankstudio_audio import AudioAnalysisError, analyze_wav

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_DURATION_SECONDS = 180
ALLOWED_ORIGINS = [
    "https://zulizhiren85-dev.github.io",
]

app = FastAPI(
    title="VoiceBankStudio Analysis API",
    version="0.1.0",
    description="Temporary WAV upload and analysis. Uploaded files are deleted after each request.",
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


@app.post("/analyze")
async def analyze(file: Annotated[UploadFile, File(...)]) -> dict:
    original_name = Path(file.filename or "audio.wav").name
    if Path(original_name).suffix.lower() not in {".wav", ".wave"}:
        raise HTTPException(status_code=415, detail="現在は非圧縮PCM WAVのみ対応しています。")

    temp_path: str | None = None
    total = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="vbs-", suffix=".wav", delete=False) as temp:
            temp_path = temp.name
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="音源は25MB以下にしてください。")
                temp.write(chunk)

        if total < 44:
            raise HTTPException(status_code=400, detail="WAVファイルが短すぎるか、壊れています。")

        # The analysis engine performs WAV validation and rejects compressed/non-PCM data.
        result = await __import__("asyncio").to_thread(analyze_wav, temp_path)
        if result["duration_seconds"] > MAX_DURATION_SECONDS:
            raise HTTPException(status_code=413, detail="現在は3分以内の音源に対応しています。")

        # Do not expose the temporary server-side filename.
        result["file_name"] = original_name
        result["upload_bytes"] = total
        result["temporary_upload"] = True
        result["server_storage"] = "deleted_after_response"
        return result
    except AudioAnalysisError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
