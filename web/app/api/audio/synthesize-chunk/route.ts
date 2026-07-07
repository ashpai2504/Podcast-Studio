import { NextResponse } from "next/server";
import { synthesizeChunk } from "@/lib/azureSpeech";
import { VOICE_PAIRS } from "@/lib/voices";

export const maxDuration = 60;

// One chunk per call, one attempt per call - the client owns retries so a
// single flaky attempt never risks pushing this invocation toward the
// function timeout.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { turns, voicePairName } = body ?? {};
    const pair = VOICE_PAIRS[voicePairName];
    if (!pair || !turns?.length) {
      return NextResponse.json(
        { error: "Missing or invalid turns/voicePairName." },
        { status: 400 }
      );
    }
    const audio = await synthesizeChunk(turns, pair);
    return new NextResponse(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audio synthesis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
