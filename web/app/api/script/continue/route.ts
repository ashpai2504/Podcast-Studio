import { NextResponse } from "next/server";
import { callAzureChat } from "@/lib/azureOpenAI";
import {
  buildContinueMessages,
  buildDraftMessages,
  computeLengthTarget,
  parseScriptJson,
} from "@/lib/scriptPrompt";

export const maxDuration = 90;

// Serverless functions are stateless between calls, so each continuation call
// reconstructs the original draft prompt (deterministic given the same
// inputs) rather than relying on any server-side conversation state.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      sourceText,
      extraInstructions = "",
      targetMinutes = null,
      host1Name,
      host2Name,
      script,
    } = body ?? {};

    if (!sourceText || !host1Name || !host2Name || !script?.turns?.length) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const baseMessages = buildDraftMessages({
      sourceText,
      extraInstructions,
      targetMinutes,
      host1Name,
      host2Name,
    });
    const { minWords, maxWords } = computeLengthTarget(targetMinutes);
    const { messages, kept } = buildContinueMessages({ baseMessages, script, minWords, maxWords });

    const raw = await callAzureChat(messages);
    const more = parseScriptJson(raw);
    if (!more?.turns?.length) {
      return NextResponse.json(
        { error: "The model returned no additional turns." },
        { status: 502 }
      );
    }
    const updated = { title: script.title, turns: [...kept, ...more.turns] };
    return NextResponse.json({ script: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script continuation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
