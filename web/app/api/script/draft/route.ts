import { NextResponse } from "next/server";
import { callAzureChat } from "@/lib/azureOpenAI";
import { buildDraftMessages, parseScriptJson } from "@/lib/scriptPrompt";

export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      sourceText,
      extraInstructions = "",
      targetMinutes = null,
      host1Name,
      host2Name,
    } = body ?? {};

    if (!sourceText || !host1Name || !host2Name) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const messages = buildDraftMessages({
      sourceText,
      extraInstructions,
      targetMinutes,
      host1Name,
      host2Name,
    });
    const raw = await callAzureChat(messages);
    const script = parseScriptJson(raw);
    if (!script?.turns?.length) {
      return NextResponse.json(
        { error: "The model returned a script with no dialogue turns." },
        { status: 502 }
      );
    }
    return NextResponse.json({ script });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
