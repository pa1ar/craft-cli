---
name: media-analyze
description: Analyze a Craft media block with OpenAI-backed generic media analysis and write results under the source block.
---

# media-analyze

Use through the curated CLI alias:

```sh
craft media analyze <blockId>
craft media analyze <blockId> --estimate
craft media analyze <blockId> --max-cost 0.50 --json
```

Direct skill form:

```sh
craft skills run media-analyze analyze <blockId>
```

V1 behavior:

- Generic media analysis only.
- OpenAI is the only provider.
- Default cost cap is EUR 1; manifest estimate is EUR 0.25.
- `craft-cli` fetches Craft block context and performs Craft writes.
- The skill downloads media to `~/.cache/craft-cli/media-analyze`.
- Video runs use `ffprobe` for metadata and `ffmpeg` for audio/contact-sheet artifacts when available.
- Raw intermediate files stay local; the Craft run block stores analysis, transcript text, contact-sheet path, and metadata JSON.

Requirements:

- `OPENAI_API_KEY` for live analysis/transcription.
- `ffmpeg` and `ffprobe` for video/audio extraction.

Failure posture:

- Missing media URL: failed result, no expensive work.
- Missing OpenAI key: failed result before OpenAI calls.
- Missing `ffmpeg`/`ffprobe`: partial result with a clear artifact note when metadata or extraction cannot run.
