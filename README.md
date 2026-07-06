# 🎙️ Hunter Podcast Studio

One tool that replaces the ChatGPT + NotebookLM workflow: upload Marketing Activity
Reports (MARs), sales reports, decks, or pasted notes, and it generates a two-host
podcast episode the rest of the company can listen to.

**How it works**

1. **Upload** PDFs, Word docs, PowerPoints, Excel MAR exports, or paste raw text.
2. **Script** — an Azure OpenAI model (default `gpt-5-mini`) synthesizes everything into a
   natural two-host dialogue, following the team's MAR-summarization style (synthesis, not
   coaching). You can edit the script before producing audio.
3. **Audio** — Azure Speech's **multi-talker DragonHD voice**
   (`en-US-MultiTalker-Ava-Andrew:DragonHDLatestNeural`) renders the whole conversation in
   one pass, with natural transitions between the two hosts. Output is an MP3, also saved
   to the `episodes/` folder.

## Setup

### 1. Azure resources

You need an **Azure AI Foundry / AI Services (multi-service) resource** — one key and
endpoint covers both models.

> ⚠️ **Region matters**: DragonHD multi-talker voices are only served from a few regions —
> **East US, West Europe, or Southeast Asia**. Create the resource in one of those
> (East US recommended).

In the Foundry portal ([ai.azure.com](https://ai.azure.com)):

1. **Deploy the chat model**: Deployments → Deploy model → `gpt-5-mini` (or `gpt-5` for
   maximum quality, `gpt-4.1-mini` for lowest cost). Note the **deployment name** you give it.
2. **Get your keys**: on the resource's *Keys and Endpoint* page, copy the key, the
   endpoint URL, and the region.

### 2. Local setup

```powershell
# from this folder
py -m venv .venv
.venv\Scripts\pip install -r requirements.txt

copy .env.example .env
# then edit .env and fill in your endpoint, key, deployment name, and region
```

### 3. Run

```powershell
.venv\Scripts\streamlit run app.py
```

The app opens in your browser at http://localhost:8501. To share with the team on the
office network: `streamlit run app.py --server.address 0.0.0.0` and give them your
machine's address, or host it on an internal server / Azure App Service.

## Deploying to Streamlit Community Cloud

This app needs a persistent Python process (not serverless functions), so it deploys to
[share.streamlit.io](https://share.streamlit.io), not Vercel.

1. Sign in at share.streamlit.io with GitHub, click **New app**, and pick this repo,
   branch `main`, main file path `app.py`.
2. Before (or right after) deploying, open the app's **Settings → Secrets** and paste in
   the same values from your `.env` file, formatted as TOML:
   ```toml
   AZURE_OPENAI_ENDPOINT = "https://your-resource.services.ai.azure.com/"
   AZURE_OPENAI_API_KEY = "your-key"
   AZURE_OPENAI_DEPLOYMENT = "gpt-5-mini"
   AZURE_OPENAI_API_VERSION = "2025-04-01-preview"
   AZURE_SPEECH_KEY = ""
   AZURE_SPEECH_REGION = "eastus"
   ```
3. Deploy. `packages.txt` and `runtime.txt` in this repo request the system libraries and
   Python version the Azure Speech SDK needs.

> If script generation works but audio synthesis fails with a shared-library error, the
> Speech SDK's native binary is missing an OS package Community Cloud doesn't ship by
> default — check the app logs for the missing `.so` name and add it to `packages.txt`.
> If that turns out to be a dead end, Azure App Service / Container Apps gives full
> control over the OS image and is the more reliable fallback for this dependency.

## Episode length

By default every episode is **20–24 minutes**, scaled to how much substance the source
material contains. To override, either pick a custom length in the sidebar or just say so
in the "Episode instructions" box (e.g. *"keep it to 10 minutes"*) — an explicit request
in the instructions always wins.

## Cost per episode (rough)

| Step | Model | ~Cost for a standard 20–24 min episode |
| --- | --- | --- |
| Script | gpt-5-mini | a few cents |
| Audio | DragonHD multi-talker ($22 / 1M chars) | ~$0.40–0.50 |

## Troubleshooting

- **Script generation fails with 404 / model not found** — the deployment *name* in `.env`
  must match what you named the deployment in Foundry, not the model family name.
- **Audio fails immediately** — usually the resource region doesn't serve DragonHD voices.
  Check the region, and that `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` point at a
  multi-service (not OpenAI-only) resource.
- **Voice sounds robotic / wrong voice** — multi-talker voices are preview; confirm the
  voice name in `podcast_studio/audio.py` still matches the
  [current voice list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices).
