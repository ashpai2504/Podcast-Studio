/**
 * Server-only Azure Speech REST client. Reads secrets from process.env - never
 * import this from a client component.
 *
 * Deliberately uses the plain REST endpoint instead of the Speech SDK: the SDK
 * ships a native binary that Vercel's serverless functions can't run, but the
 * REST endpoint accepts the exact same SSML (including the multi-talker
 * <mstts:dialog> elements) with no native dependency at all.
 */
import "server-only";
import { buildSsml } from "./ssml";
import type { Turn } from "./types";
import type { VoicePair } from "./voices";

function getSettings() {
  const region = process.env.AZURE_SPEECH_REGION || "eastus";
  const key = process.env.AZURE_SPEECH_KEY || process.env.AZURE_OPENAI_API_KEY;
  if (!key) {
    throw new Error("This tool isn't connected yet - please contact your admin to finish setup.");
  }
  return { region, key };
}

export async function synthesizeChunk(turns: Turn[], pair: VoicePair): Promise<ArrayBuffer> {
  const { region, key } = getSettings();
  const ssml = buildSsml(turns, pair);
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "HunterPodcastStudio",
    },
    body: ssml,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Azure Speech request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  return res.arrayBuffer();
}
