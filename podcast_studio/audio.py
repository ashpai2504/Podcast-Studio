"""Turn a dialogue script into podcast audio with Azure Speech multi-talker HD voices."""

from xml.sax.saxutils import escape

import azure.cognitiveservices.speech as speechsdk

from .config import Settings

# Multi-talker DragonHD voices synthesize a whole two-person dialogue in one call,
# keeping tone and pacing coherent across speaker transitions.
VOICE_PAIRS = {
    "Ava & Andrew": {
        "voice": "en-US-MultiTalker-Ava-Andrew:DragonHDLatestNeural",
        "speakers": ("ava", "andrew"),
        "display": ("Ava", "Andrew"),
    },
    "Ava & Steffan": {
        "voice": "en-US-MultiTalker-Ava-Steffan:DragonHDLatestNeural",
        "speakers": ("ava", "steffan"),
        "display": ("Ava", "Steffan"),
    },
}

# Keep each SSML request small - the preview multi-talker voice synthesizes slowly
# under load, and shorter requests are far less likely to hit service timeouts.
MAX_CHARS_PER_REQUEST = 3000

MAX_ATTEMPTS_PER_CHUNK = 3

NEURAL_HD_PRICE_PER_MILLION_CHARS = 22.0  # USD, March 2026 pricing


def estimate_cost(turns: list[dict]) -> float:
    chars = sum(len(t["text"]) for t in turns)
    return chars * NEURAL_HD_PRICE_PER_MILLION_CHARS / 1_000_000


def synthesize_podcast(
    settings: Settings,
    turns: list[dict],
    voice_pair_name: str,
    progress_callback=None,
) -> bytes:
    """Synthesize the full dialogue to MP3 bytes, chunking long scripts across requests."""
    pair = VOICE_PAIRS[voice_pair_name]

    speech_config = speechsdk.SpeechConfig(
        subscription=settings.effective_speech_key, region=settings.speech_region
    )
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3
    )
    # The preview multi-talker voice can run slower than real-time under load;
    # relax the SDK's stall-detection thresholds so slow chunks aren't cancelled.
    for prop, value in (
        ("SpeechSynthesis_FrameTimeoutInterval", "120000"),
        ("SpeechSynthesis_RtfTimeoutThreshold", "20"),
    ):
        prop_id = getattr(speechsdk.PropertyId, prop, None)
        if prop_id is not None:
            speech_config.set_property(prop_id, value)

    chunks = _chunk_turns(turns)
    audio = bytearray()
    for i, chunk in enumerate(chunks):
        if progress_callback:
            progress_callback(i, len(chunks))
        ssml = _build_ssml(chunk, pair)
        last_error = None
        for _attempt in range(MAX_ATTEMPTS_PER_CHUNK):
            # A fresh synthesizer per attempt avoids reusing a stalled connection.
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=speech_config, audio_config=None
            )
            result = synthesizer.speak_ssml_async(ssml).get()
            if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                audio.extend(result.audio_data)
                last_error = None
                break
            last_error = ""
            if result.reason == speechsdk.ResultReason.Canceled:
                cancellation = result.cancellation_details
                last_error = f": {cancellation.reason} - {cancellation.error_details}"
        if last_error is not None:
            raise RuntimeError(
                f"Speech synthesis failed on part {i + 1}/{len(chunks)} after "
                f"{MAX_ATTEMPTS_PER_CHUNK} attempts{last_error}"
            )
    if progress_callback:
        progress_callback(len(chunks), len(chunks))
    return bytes(audio)


def _chunk_turns(turns: list[dict]) -> list[list[dict]]:
    """Split the dialogue into groups of turns that each fit in one synthesis request."""
    chunks: list[list[dict]] = []
    current: list[dict] = []
    size = 0
    for turn in turns:
        turn_len = len(turn["text"])
        if current and size + turn_len > MAX_CHARS_PER_REQUEST:
            chunks.append(current)
            current, size = [], 0
        current.append(turn)
        size += turn_len
    if current:
        chunks.append(current)
    return chunks


def _build_ssml(turns: list[dict], pair: dict) -> str:
    speaker_ids = {"host1": pair["speakers"][0], "host2": pair["speakers"][1]}
    turn_elements = "\n".join(
        f'      <mstts:turn speaker="{speaker_ids[t["speaker"]]}">{escape(t["text"])}</mstts:turn>'
        for t in turns
    )
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
        "xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>\n"
        f"  <voice name='{pair['voice']}'>\n"
        "    <mstts:dialog>\n"
        f"{turn_elements}\n"
        "    </mstts:dialog>\n"
        "  </voice>\n"
        "</speak>"
    )
