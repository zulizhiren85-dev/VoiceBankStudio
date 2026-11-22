# VoiceBankStudio analysis server

This FastAPI service accepts temporary audio uploads, converts supported formats to mono 16-bit PCM WAV at 22,050 Hz with PyAV/FFmpeg, and runs the existing Python/C analysis engine.

## Supported input

- WAV / WAVE
- MP3
- FLAC
- M4A
- AAC
- AIFF / AIF
- OGG
- OPUS
- WMA (codec support depends on the uploaded file)

## Limits and privacy

- Maximum upload: 25 MB
- Maximum duration: 180 seconds
- Input and converted WAV are temporary files and are deleted after the request.
- No database or permanent audio storage is used.
- CORS is restricted to the VoiceBankStudio GitHub Pages origin.
- Uploading uses network data. The browser asks before automatic upload.

## Deploy

The root `render.yaml` defines a Render web service. Render installs the Python dependencies, including PyAV (FFmpeg-backed decoding), and the local analysis engine.

Render free services can sleep after 15 minutes idle and may take about a minute to wake up. The free plan is for testing, not production.

## API

- `GET /` and `GET /health`: health checks
- `POST /analyze`: multipart form upload with field name `file`

The response includes duration, pitch timeline, and rough tempo estimate. Pitch and BPM are estimates, not full melody transcription, chord recognition, or vocal separation.
