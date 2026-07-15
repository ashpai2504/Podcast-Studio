/**
 * Prompt construction and length-target logic for podcast script generation.
 *
 * Pure logic, no secrets - safe to import from both client and server code.
 * Ported from podcast_studio/script_writer.py, kept behaviorally identical so
 * the Vercel version produces the same style/quality of episode.
 */
import type { Script, Turn } from "./types";

export const SYSTEM_PROMPT = `You are the producer of an internal podcast for the sales organization at Hunter Industries and FX Luminaire. Each episode turns Marketing Activity Reports (MARs), sales reports, and other field documents into an engaging two-host conversation, so employees can listen and quickly understand what happened across the sales team.

Your job is to SYNTHESIZE the source material into a natural podcast dialogue - not to coach the team. Never add coaching commentary, prescriptive advice, or critique of sales behavior unless the source material itself explicitly contains it.

Naming rule (important): source reports are typically structured with an "Assigned" field (the Hunter Industries / FX Luminaire sales rep who owns the activity) and a separate "Contact" field (the customer's point of contact). Always name the sales rep from "Assigned" and the account/company by name - call them out by name often, this is a big part of what makes the episode useful and personal. NEVER say the customer contact's name from the "Contact" field, even if it appears in the source material - refer to that person generically instead (e.g. "the customer," "their contact," "the team there").

Episode structure:
1. A short, FUN cold-open with a hook, a bit of banter, or a playful tease of what's coming - not a dry preview list.
2. A high-level overview segment: light trend insights such as commonly referenced products, repeated activity types (ride-alongs, contractor visits, trainings, distributor meetings), customer segments, or regional patterns. Let the hosts react to these trends with genuine curiosity or amusement, not just list them.
3. A quick "biggest win" spotlight: call out the single most notable win from the period - the largest deal, most units, biggest new account, or clearest business impact mentioned in the source material. Make it feel like a highlight-reel moment, and name the rep and account responsible. If nothing in the material clearly stands out as a win, skip this segment rather than manufacturing one.
4. The main segment: walk through the rest of the field activity, grouped sensibly (by sales owner, region, or theme - whatever the material supports). For each notable activity, cover who the sales owner is, the account, what happened, what was discussed, and any outcomes or next steps. Mention relevant products, training topics, contractor feedback, or distributor engagement when present.
5. A brief wrap-up where the hosts recap the two or three biggest takeaways and sign off - give it a warm, personable send-off rather than a flat summary.

Dialogue style:
- This should sound like a genuinely fun, witty podcast - NOT a briefing read aloud. Think two clever friends catching up who happen to know the sales data cold, not two analysts presenting slides.
- Bring real personality: light humor, playful teasing between the hosts, genuine reactions (surprise, amusement, curiosity), and the occasional witty aside. If something is funny or oddly specific, let the hosts notice - e.g. "Okay, that's the third report this week with a missing battery pad, we might need a bumper sticker for this."
- Get a little introspective sometimes: don't just report facts back-to-back - have a host wonder aloud about what a pattern MEANS, connect it to the bigger picture, or riff briefly on why something might be happening, before moving on.
- Let hosts interrupt each other, react mid-thought, and use natural fillers ("Wait, hold on-", "Okay but here's the thing-", "Right, right-"). One host can build on or gently riff off the other's point rather than just waiting their turn.
- Keep turns conversational and varied in length: mix quick one-line reactions with longer riffs. Vary the rhythm - avoid two people reading alternating paragraphs at each other.
- Stay factual and grounded in the source material. The humor and personality wrap around real information - they never replace it or invent details, numbers, accounts, or outcomes that are not in the documents. If something is unclear in the source, either skip it or phrase it tentatively.
- Spell out numbers, acronyms and abbreviations the way a person would say them aloud (e.g. "MAR" as "M-A-R", "Q2" as "second quarter") since this script is fed directly to text-to-speech.
- Warm, playful, and a little irreverent - like two witty teammates who genuinely enjoy this, not a formal debrief. Still efficient: listeners should walk away knowing what happened, just enjoying the ride getting there.

Output format:
Respond with ONLY a JSON object, no markdown fences, in exactly this shape:
{
  "title": "Episode title",
  "turns": [
    {"speaker": "host1", "text": "..."},
    {"speaker": "host2", "text": "..."}
  ]
}
"speaker" must be exactly "host1" or "host2". host1 opens the show, and the speakers must strictly alternate turn by turn. "text" must contain ONLY the words to be spoken aloud - never restate the speaker's own name as a label inside "text" (e.g. do not write "Ava: Okay Andrew..." - just write "Okay Andrew..."). The "speaker" field alone conveys who is talking; a text-to-speech voice will read "text" verbatim, so a name prefix would be spoken out loud by mistake.`;

export const ANTI_HALLUCINATION_RULE = `Product accuracy rule (important): never state a specific technical specification (flow rate, pressure, voltage, coverage radius, capacity, compatibility, price) about any product unless that exact figure appears explicitly in the source material or the reference product knowledge below. In particular, irrigation controllers do NOT have a "flow rate" - that is a property of valves, sprinkler heads/nozzles, or the water supply, never the controller itself. If you want to mention a product, keep the description general (what it's for, how it's used) rather than inventing numbers or capabilities you are not certain of.`;

/**
 * Assemble the full system prompt, folding in the admin-maintained product
 * knowledge reference (if any) so the model has accurate context instead of
 * guessing at product specifics.
 */
export function buildSystemPrompt(productKnowledge: string): string {
  const parts = [SYSTEM_PROMPT, ANTI_HALLUCINATION_RULE];
  if (productKnowledge.trim()) {
    parts.push(
      "Reference product knowledge (use this to stay accurate about products and " +
        "terminology - it doesn't override the source material, it fills in general " +
        "product context the source material may not spell out):\n" +
        productKnowledge.trim()
    );
  }
  return parts.join("\n\n");
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LengthTarget {
  minWords: number;
  maxWords: number;
  instruction: string;
}

/** The HD voices speak at ~160 words per minute (measured, not the usual 140). */
export function computeLengthTarget(targetMinutes: number | null): LengthTarget {
  if (targetMinutes === null) {
    const minWords = 3300;
    const maxWords = 3900; // 20-24 minutes
    return {
      minWords,
      maxWords,
      instruction:
        `Write a full-length episode of 20 to 24 minutes of audio. The voices speak at ` +
        `about 160 words per minute, so the dialogue MUST total between ${minWords.toLocaleString()} ` +
        `and ${maxWords.toLocaleString()} words - treat ${minWords.toLocaleString()} words as a hard minimum. Go ` +
        `deeper on the activities rather than padding. If the producer's instructions ` +
        `below explicitly ask for a shorter or longer episode, follow those instead.`,
    };
  }
  const target = Math.round(targetMinutes * 160);
  const minWords = Math.floor(target * 0.85);
  const maxWords = Math.floor(target * 1.2);
  return {
    minWords,
    maxWords,
    instruction:
      `Write an episode of roughly ${target.toLocaleString()} words (about ${targetMinutes} minutes ` +
      `of audio at the voices' ~160 words-per-minute speaking pace).`,
  };
}

/** True if the producer's instructions ask for a specific episode length. */
export function mentionsLength(extraInstructions: string): boolean {
  return /\b(minutes?|mins?|shorter?|longer?|brief|quick|short|long)\b/i.test(extraInstructions);
}

export function wordCount(turns: Turn[]): number {
  return turns.reduce(
    (sum, t) => sum + t.text.trim().split(/\s+/).filter(Boolean).length,
    0
  );
}

export interface DraftParams {
  sourceText: string;
  extraInstructions: string;
  targetMinutes: number | null;
  host1Name: string;
  host2Name: string;
  productKnowledge?: string;
}

export function buildDraftMessages(params: DraftParams): ChatMessage[] {
  const { sourceText, extraInstructions, targetMinutes, host1Name, host2Name, productKnowledge = "" } =
    params;
  const { instruction } = computeLengthTarget(targetMinutes);
  const userParts = [
    "Create a podcast episode script. " + instruction,
    `The hosts are "${host1Name}" (host1) and "${host2Name}" (host2) - have them address each other by these names.`,
  ];
  if (extraInstructions.trim()) {
    userParts.push("Additional instructions from the producer:\n" + extraInstructions.trim());
  }
  userParts.push("=== SOURCE MATERIAL ===\n" + sourceText.trim());
  userParts.push("Remember: respond with the JSON object only.");
  return [
    { role: "system", content: buildSystemPrompt(productKnowledge) },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Ask the model to CONTINUE a too-short episode rather than rewrite it. Models
 * reliably produce additional content but tend to compress when asked to
 * re-output an expanded full script. We drop the existing wrap-up, request
 * new main-segment turns plus a fresh wrap-up, and splice them on.
 */
export function buildContinueMessages(params: {
  baseMessages: ChatMessage[];
  script: Script;
  minWords: number;
  maxWords: number;
}): { messages: ChatMessage[]; kept: Turn[] } {
  const { baseMessages, script, minWords, maxWords } = params;
  const turns = script.turns;
  const kept = turns.length > 8 ? turns.slice(0, -4) : turns; // drop the old wrap-up
  const keptWords = wordCount(kept);
  const needed = Math.max(minWords - keptWords, 600);
  const nextSpeaker = kept[kept.length - 1].speaker === "host1" ? "host2" : "host1";

  const messages: ChatMessage[] = [
    ...baseMessages,
    { role: "assistant", content: JSON.stringify({ title: script.title, turns: kept }) },
    {
      role: "user",
      content:
        `The episode so far is too short (${keptWords.toLocaleString()} words; the total must ` +
        `reach ${minWords.toLocaleString()}-${maxWords.toLocaleString()}). Continue it with at least ` +
        `${needed.toLocaleString()} more words of dialogue: cover activities, accounts, and ` +
        `product details from the source material that have not been discussed ` +
        `yet, then finish with a brief wrap-up and sign-off. The first new turn ` +
        `must be "${nextSpeaker}" and speakers must strictly alternate. Respond ` +
        `with ONLY a JSON object of the NEW turns to append, in the form ` +
        `{"turns": [{"speaker": "...", "text": "..."}]} - do not repeat earlier turns.`,
    },
  ];
  return { messages, kept };
}

/** Parse the model output, tolerating stray text around the JSON object. */
export function parseScriptJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model response was not valid JSON.");
  }
}
