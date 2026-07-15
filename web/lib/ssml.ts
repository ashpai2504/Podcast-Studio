/** SSML building and chunking for multi-talker synthesis. Pure logic, no secrets. */
import type { Turn } from "./types";
import { MAX_CHARS_PER_REQUEST, type VoicePair } from "./voices";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Words the model spells normally but the voice mispronounces. Each alias is a
// phonetic respelling the TTS engine reads using normal English pronunciation
// rules (via SSML <sub>), not IPA - easy to tweak by ear without any code
// changes elsewhere.
const PRONUNCIATIONS: [RegExp, string][] = [[/\bcentralus\b/gi, "sen-TRAWL-iss"]];

/** Escape text for SSML, splicing in <sub> aliases for known mispronunciations. */
function applyPronunciations(text: string): string {
  const spans: { start: number; end: number; alias: string }[] = [];
  for (const [pattern, alias] of PRONUNCIATIONS) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index!, end: match.index! + match[0].length, alias });
    }
  }
  spans.sort((a, b) => a.start - b.start);

  const pieces: string[] = [];
  let last = 0;
  for (const { start, end, alias } of spans) {
    if (start < last) continue; // overlapping match, keep the earlier one
    pieces.push(escapeXml(text.slice(last, start)));
    pieces.push(`<sub alias="${escapeXml(alias)}">${escapeXml(text.slice(start, end))}</sub>`);
    last = end;
  }
  pieces.push(escapeXml(text.slice(last)));
  return pieces.join("");
}

/** Split the dialogue into groups of turns that each fit in one synthesis request. */
export function chunkTurns(turns: Turn[], maxChars: number = MAX_CHARS_PER_REQUEST): Turn[][] {
  const chunks: Turn[][] = [];
  let current: Turn[] = [];
  let size = 0;
  for (const turn of turns) {
    const turnLen = turn.text.length;
    if (current.length && size + turnLen > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(turn);
    size += turnLen;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function buildSsml(turns: Turn[], pair: VoicePair): string {
  const speakerIds: Record<string, string> = { host1: pair.speakers[0], host2: pair.speakers[1] };
  const turnElements = turns
    .map(
      (t) =>
        `      <mstts:turn speaker="${speakerIds[t.speaker]}">${applyPronunciations(t.text)}</mstts:turn>`
    )
    .join("\n");
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' ` +
    `xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>\n` +
    `  <voice name='${pair.voice}'>\n` +
    `    <mstts:dialog>\n${turnElements}\n    </mstts:dialog>\n` +
    `  </voice>\n` +
    `</speak>`
  );
}
