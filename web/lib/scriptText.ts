/** Convert between {turns} and editable "Name: line" text for the script textarea. */
import type { Script, Speaker, Turn } from "./types";

export function turnsToEditableText(
  script: Script,
  host1Name: string,
  host2Name: string
): string {
  const names: Record<Speaker, string> = { host1: host1Name, host2: host2Name };
  return script.turns
    .map((t) => `${names[t.speaker] ?? t.speaker}: ${t.text.trim()}`)
    .join("\n\n");
}

export function editableTextToTurns(
  text: string,
  host1Name: string,
  host2Name: string
): Turn[] {
  const speakers: Record<string, Speaker> = {
    [host1Name.toLowerCase()]: "host1",
    [host2Name.toLowerCase()]: "host2",
  };
  const turns: Turn[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([^:]{1,40}):\s*([\s\S]+)$/);
    const speaker = match ? speakers[match[1].trim().toLowerCase()] : undefined;
    if (speaker && match) {
      turns.push({ speaker, text: match[2].trim() });
    } else if (turns.length) {
      turns[turns.length - 1].text += " " + line;
    }
  }
  return turns;
}
