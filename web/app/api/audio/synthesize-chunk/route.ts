import { NextResponse } from "next/server";
import { synthesizeChunk } from "@/lib/azureSpeech";
import { INDIVIDUAL_VOICES, MULTI_TALKER_PAIRS, type VoiceSelection } from "@/lib/voices";

export const maxDuration = 60;

function isValidSelection(selection: VoiceSelection | undefined): selection is VoiceSelection {
  if (!selection) return false;
  if (selection.mode === "individual") {
    return !!(INDIVIDUAL_VOICES[selection.host1Id] && INDIVIDUAL_VOICES[selection.host2Id]);
  }
  if (selection.mode === "multitalker") {
    return !!MULTI_TALKER_PAIRS[selection.pairName];
  }
  return false;
}

// One chunk per call, one attempt per call - the client owns retries so a
// single flaky attempt never risks pushing this invocation toward the
// function timeout.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { turns, voiceSelection } = body ?? {};
    if (!isValidSelection(voiceSelection) || !turns?.length) {
      return NextResponse.json(
        { error: "Missing or invalid turns/voiceSelection." },
        { status: 400 }
      );
    }
    const audio = await synthesizeChunk(turns, voiceSelection);
    return new NextResponse(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audio synthesis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
