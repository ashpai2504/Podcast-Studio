# Hunter Podcast Studio — Vercel edition

A from-scratch Next.js/TypeScript rewrite of the Streamlit app in the repo root, built
specifically to run on Vercel (the Streamlit version can't — see below). Same feature
set: upload sales reports/MARs, generate a two-host podcast script with Azure OpenAI,
produce audio with Azure Speech's multi-talker DragonHD voice.

## Why this exists as a separate app

Streamlit needs one persistent, long-lived server process. Vercel only runs short-lived
serverless functions. So this version is architected differently:

- **File parsing runs in the browser** (`lib/extract.ts`), not on the server — PDFs,
  Word docs, PowerPoints, and Excel files never leave the user's machine as raw bytes,
  only the extracted text does. This also sidesteps Vercel's request body size limits.
- **Audio synthesis calls Azure Speech's plain REST endpoint**, not the Speech SDK. The
  SDK is a native binary Vercel's serverless functions can't run; the REST API accepts
  the exact same SSML (confirmed working, including the multi-talker `<mstts:dialog>`
  elements) with zero native dependencies.
- **The browser orchestrates multi-step generation.** A full episode's script (with its
  length-enforcement loop) and audio (chunked synthesis) together take 6–10+ minutes —
  far beyond any Vercel function timeout. So each API route does ONE short step (one
  OpenAI call, one audio chunk) and returns immediately; the client calls them repeatedly,
  holding state (the draft script, the audio buffers) in memory and assembling the final
  MP3 client-side via `Blob` concatenation. No database or blob storage needed.

## Known limitations

- **Nothing is saved server-side.** Unlike the Streamlit version's `episodes/` folder,
  the finished MP3 only exists as an in-browser Blob until the user clicks download.
  Closing the tab loses it.
- **Very large uploads**: extracted text for all documents combined is resent on every
  script-continuation call. This comfortably handles a large Excel MAR export (~400K
  characters, tested), but an extreme volume of documents at once could approach request
  body limits.
- The multi-talker voice is an Azure preview feature; if Microsoft changes the REST
  behavior for it, `lib/azureSpeech.ts` is the one place that would need updating.

## Local development

```powershell
cd web
npm install
copy .env.local.example .env.local
# fill in .env.local with your Azure values
npm run dev
```

Open http://localhost:3000 (or whatever port it prints — if 3000 is taken by another
app on your machine, run `npm run dev -- -p 3001` or similar).

## Deploying to Vercel

This repo also contains the original Streamlit app at its root, so Vercel's project
settings must be told to build from this subfolder:

1. In the Vercel project → **Settings → General → Root Directory**, set it to `web`.
2. In **Settings → Environment Variables**, add:
   | Name | Value |
   | --- | --- |
   | `AZURE_OPENAI_ENDPOINT` | `https://your-resource.services.ai.azure.com/` |
   | `AZURE_OPENAI_API_KEY` | your key |
   | `AZURE_OPENAI_DEPLOYMENT` | `gpt-5-mini` (or your deployment name) |
   | `AZURE_OPENAI_API_VERSION` | `2025-04-01-preview` |
   | `AZURE_SPEECH_KEY` | leave blank to reuse the OpenAI key (multi-service resource) |
   | `AZURE_SPEECH_REGION` | `eastus` (must be a region that serves DragonHD voices) |
3. Redeploy.

If a deploy succeeds but audio generation fails, check the function logs for the
specific Azure Speech error — most likely cause is the resource region not serving
DragonHD multi-talker voices (only East US, West Europe, and Southeast Asia do).

## Project layout

- `app/page.tsx` — the entire UI (source upload, script editor, audio player) as one
  client component.
- `app/api/script/draft`, `app/api/script/continue` — script generation steps.
- `app/api/audio/synthesize-chunk` — one audio chunk per call.
- `lib/scriptPrompt.ts`, `lib/scriptText.ts` — prompt construction and script-text
  formatting, ported from `podcast_studio/script_writer.py`.
- `lib/ssml.ts`, `lib/voices.ts` — SSML building and chunking, ported from
  `podcast_studio/audio.py`.
- `lib/azureOpenAI.ts`, `lib/azureSpeech.ts` — the only two files that touch secrets
  (`server-only`, never bundled to the client).
- `lib/extract.ts` — client-side document parsing (PDF via `pdfjs-dist`, DOCX via
  `mammoth`, PPTX via manual `jszip` + `DOMParser`, XLSX via `xlsx`).
