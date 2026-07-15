/**
 * Two ways to pick hosts. Pure config, no secrets - safe to import from both
 * client and server code.
 *
 * - Multi-talker pairs: a single special voice model that synthesizes both
 *   hosts together, giving the smoothest, most coherent back-and-forth. Only
 *   ships as a couple of fixed combinations today.
 * - Individual voices: any two standalone DragonHD voices, each synthesizing
 *   their own lines. Full library flexibility, transitions are a touch less
 *   seamless since each turn is a separate voice invocation.
 */
export interface VoicePair {
  voice: string;
  speakers: [string, string];
  display: [string, string];
}

export const MULTI_TALKER_PAIRS: Record<string, VoicePair> = {
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

export interface IndividualVoice {
  voice: string;
  display: string;
  gender: "Male" | "Female";
  vibe: string;
}

// A curated library of standalone DragonHD voices for "mix your own hosts" -
// pick any two, including two of the same gender. Vibe descriptions are our
// own framing to help with picking, not official Microsoft copy - preview
// them before committing.
export const INDIVIDUAL_VOICES: Record<string, IndividualVoice> = {
  andrew3: {
    voice: "en-us-Andrew3:DragonHDLatestNeural",
    display: "Andrew",
    gender: "Male",
    vibe: "Podcast-tuned, easygoing",
  },
  ava3: {
    voice: "en-us-Ava3:DragonHDLatestNeural",
    display: "Ava",
    gender: "Female",
    vibe: "Podcast-tuned, curious",
  },
  davis: {
    voice: "en-us-Davis:DragonHDLatestNeural",
    display: "Davis",
    gender: "Male",
    vibe: "Laid-back, dry humor",
  },
  nova: {
    voice: "en-us-Nova:DragonHDLatestNeural",
    display: "Nova",
    gender: "Female",
    vibe: "Sharp, witty",
  },
  brian: {
    voice: "en-us-Brian:DragonHDLatestNeural",
    display: "Brian",
    gender: "Male",
    vibe: "Confident, upbeat",
  },
  jenny: {
    voice: "en-us-Jenny:DragonHDLatestNeural",
    display: "Jenny",
    gender: "Female",
    vibe: "Warm, friendly",
  },
  adam: {
    voice: "en-us-Adam:DragonHDLatestNeural",
    display: "Adam",
    gender: "Male",
    vibe: "Steady, thoughtful",
  },
  serena: {
    voice: "en-us-Serena:DragonHDLatestNeural",
    display: "Serena",
    gender: "Female",
    vibe: "Polished, energetic",
  },
};

export type VoiceSelection =
  | { mode: "multitalker"; pairName: string }
  | { mode: "individual"; host1Id: string; host2Id: string };

export function resolveHostNames(selection: VoiceSelection): [string, string] {
  if (selection.mode === "individual") {
    return [
      INDIVIDUAL_VOICES[selection.host1Id].display,
      INDIVIDUAL_VOICES[selection.host2Id].display,
    ];
  }
  return MULTI_TALKER_PAIRS[selection.pairName].display;
}

// Keep each SSML request small - the preview multi-talker voice synthesizes
// slowly under load, and shorter requests are far less likely to hit service
// timeouts (and comfortably fit a single short-lived Vercel function call).
export const MAX_CHARS_PER_REQUEST = 3000;
