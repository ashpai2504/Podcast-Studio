/**
 * Multi-talker DragonHD voice pairs. Pure config, no secrets - safe to import
 * from both client and server code.
 */
export interface VoicePair {
  voice: string;
  speakers: [string, string];
  display: [string, string];
}

export const VOICE_PAIRS: Record<string, VoicePair> = {
  "Ava & Andrew": {
    voice: "en-US-MultiTalker-Ava-Andrew:DragonHDLatestNeural",
    speakers: ["ava", "andrew"],
    display: ["Ava", "Andrew"],
  },
  "Ava & Steffan": {
    voice: "en-US-MultiTalker-Ava-Steffan:DragonHDLatestNeural",
    speakers: ["ava", "steffan"],
    display: ["Ava", "Steffan"],
  },
};

export const DEFAULT_VOICE_PAIR = "Ava & Andrew";

// Keep each SSML request small - the preview multi-talker voice synthesizes
// slowly under load, and shorter requests are far less likely to hit
// service timeouts (and comfortably fit a single short-lived Vercel function call).
export const MAX_CHARS_PER_REQUEST = 3000;
