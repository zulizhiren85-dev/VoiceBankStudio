# VoiceBankStudio analysis server

This FastAPI service accepts temporary, uncompressed PCM WAV uploads and runs the existing Python/C analysis engine.

## Limits

- WAV PCM only (8/16/24/32-bit integer PCM, 1–8 channels as supported by the engine)
- Maximum upload: 25 MB
- Maximum duration: 180 seconds
- Uploads are written to a temporary file and removed in a `finally` block after analysis.
- No database or permanent audio storage is used.
- CORS is restricted to the VoiceBankStudio GitHub Pages origin.

## Deploy

The root `render.yaml` defines a free Render web service. Connect this repository to Render and deploy the Blueprint. Render free services can sleep after 15 minutes idle and may take about a minute to wake up. The free plan is for testing, not production.

After deployment, the service URL will look like `https://voicebankstudio-analysis.onrender.com`. Set that URL in the browser app's API configuration before using server analysis.

## API

- `GET /` and `GET /health`: health checks
- `POST /analyze`: multipart form upload with field name `file`

The response is JSON containing duration, pitch timeline, and rough tempo estimate. Pitch and BPM are estimates, not full melody transcription or vocal separation.
