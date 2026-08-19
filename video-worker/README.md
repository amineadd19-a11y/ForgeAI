# ForgeAI Video Worker

Standalone heavy renderer for Movie Studio. It is intentionally outside the Next.js/Vercel runtime.

## Responsibilities

- accept queued render jobs over HTTP
- download already-rendered scene videos
- concatenate scenes with FFmpeg
- report job status and render metadata

AI generation remains in ForgeAI. This service owns CPU-heavy media work.

## Run locally

```bash
docker build -t forgeai-video-worker ./video-worker
docker run --rm -p 8080:8080 -e WORKER_TOKEN=change-me forgeai-video-worker
```

Health: `GET /health`

Create a job: `POST /jobs` with `Authorization: Bearer <WORKER_TOKEN>` and a JSON body containing `scenes: [{"videoUrl":"https://..."}]`.

Check a job: `GET /jobs/<id>`.

## Production notes

The current worker is the first rendering foundation. Before exposing it publicly, move job state to durable storage and replace the temporary in-memory result transport with object storage (S3-compatible/R2/etc.). Keep `WORKER_TOKEN` private and only expose the worker through ForgeAI's gateway.
