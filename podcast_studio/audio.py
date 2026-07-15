"""Turn a dialogue script into podcast audio with Azure Speech DragonHD voices.

Two ways to pick hosts:
- Multi-talker pairs: a single special voice model that synthesizes both hosts
  together, giving the smoothest, most coherent back-and-forth. Only ships as
  a couple of fixed combinations today.
- Mix-your-own: any two individual DragonHD voices, each synthesizing their
  own lines. Full library flexibility, transitions are a touch less seamless
  since each turn is a separate voice invocation rather than one dialog call.
"""

import re
from xml.sax.saxutils import escape

import azure.cognitiveservices.speech as speechsdk

from .config import Settings

# Words the model spells normally but the voice mispronounces. Each alias is a
# phonetic respelling the TTS engine reads using normal English pronunciation
# rules (via SSML <sub>), not IPA - easy to tweak by ear without any code
# changes elsewhere.
PRONUNCIATIONS = {
    re.compile(r"\bcentralus\b", re.IGNORECASE): "sen-TRAWL-iss",
}


def _apply_pronunciations(text: str) -> str:
    """Escape text for SSML, splicing in <sub> aliases for known mispronunciations."""
    spans = []
    for pattern in PRONUNCIATIONS:
        for match in pattern.finditer(text):
            spans.append((match.start(), match.end(), pattern))
    spans.sort()

    pieces = []
    last = 0
    for start, end, pattern in spans:
        if start < last:
            continue  # overlapping match, keep the earlier one
        pieces.append(escape(text[last:start]))
        alias = PRONUNCIATIONS[pattern]
        pieces.append(f'<sub alias="{escape(alias)}">{escape(text[start:end])}</sub>')
        last = end
    pieces.append(escape(text[last:]))
    return "".join(pieces)


# Multi-talker DragonHD voices synthesize a whole two-person dialogue in one call,
# keeping tone and pacing coherent across speaker transitions.
MULTI_TALKER_PAIRS = {
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

# A curated library of standalone DragonHD voices for "mix your own hosts" -
# pick any two, including two of the same gender. Vibe descriptions are our
# own framing to help with picking, not official Microsoft copy - preview
# them before committing.
INDIVIDUAL_VOICES = {
    "andrew3": {
        "voice": "en-us-Andrew3:DragonHDLatestNeural",
        "display": "Andrew",
        "gender": "Male",
        "vibe": "Podcast-tuned, easygoing",
    },
    "ava3": {
        "voice": "en-us-Ava3:DragonHDLatestNeural",
        "display": "Ava",
        "gender": "Female",
        "vibe": "Podcast-tuned, curious",
    },
    "davis": {
        "voice": "en-us-Davis:DragonHDLatestNeural",
        "display": "Davis",
        "gender": "Male",
        "vibe": "Laid-back, dry humor",
    },
    "nova": {
        "voice": "en-us-Nova:DragonHDLatestNeural",
        "display": "Nova",
        "gender": "Female",
        "vibe": "Sharp, witty",
    },
    "brian": {
        "voice": "en-us-Brian:DragonHDLatestNeural",
        "display": "Brian",
        "gender": "Male",
        "vibe": "Confident, upbeat",
    },
    "jenny": {
        "voice": "en-us-Jenny:DragonHDLatestNeural",
        "display": "Jenny",
        "gender": "Female",
        "vibe": "Warm, friendly",
    },
    "adam": {
        "voice": "en-us-Adam:DragonHDLatestNeural",
        "display": "Adam",
        "gender": "Male",
        "vibe": "Steady, thoughtful",
    },
    "serena": {
        "voice": "en-us-Serena:DragonHDLatestNeural",
        "display": "Serena",
        "gender": "Female",
        "vibe": "Polished, energetic",
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


def resolve_host_names(voice_selection) -> tuple[str, str]:
    """Return (host1_name, host2_name) for a multi-talker pair name or an
    (individual_voice_id, individual_voice_id) tuple."""
    if isinstance(voice_selection, tuple):
        host1_id, host2_id = voice_selection
        return INDIVIDUAL_VOICES[host1_id]["display"], INDIVIDUAL_VOICES[host2_id]["display"]
    pair = MULTI_TALKER_PAIRS[voice_selection]
    return pair["display"]


def synthesize_podcast(
    settings: Settings,
    turns: list[dict],
    voice_selection,
    progress_callback=None,
) -> bytes:
    """Synthesize the full dialogue to MP3 bytes, chunking long scripts across requests.

    voice_selection is either a MULTI_TALKER_PAIRS key (str) for the smooth
    dialog voice, or a 2-tuple of INDIVIDUAL_VOICES keys (host1_id, host2_id)
    for "mix your own hosts".
    """
    if isinstance(voice_selection, tuple):
        host1_voice = INDIVIDUAL_VOICES[voice_selection[0]]["voice"]
        host2_voice = INDIVIDUAL_VOICES[voice_selection[1]]["voice"]
        build_ssml = lambda chunk: _build_ssml_individual(chunk, host1_voice, host2_voice)
    else:
        pair = MULTI_TALKER_PAIRS[voice_selection]
        build_ssml = lambda chunk: _build_ssml_multitalker(chunk, pair)

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
        ssml = build_ssml(chunk)
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


def _build_ssml_multitalker(turns: list[dict], pair: dict) -> str:
    speaker_ids = {"host1": pair["speakers"][0], "host2": pair["speakers"][1]}
    turn_elements = "\n".join(
        f'      <mstts:turn speaker="{speaker_ids[t["speaker"]]}">{_apply_pronunciations(t["text"])}</mstts:turn>'
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


def _build_ssml_individual(turns: list[dict], host1_voice: str, host2_voice: str) -> str:
    """Each turn gets its own <voice> block using that host's individually chosen voice."""
    voice_names = {"host1": host1_voice, "host2": host2_voice}
    voice_elements = "\n".join(
        f'  <voice name=\'{voice_names[t["speaker"]]}\'>{_apply_pronunciations(t["text"])}</voice>'
        for t in turns
    )
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
        "xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>\n"
        f"{voice_elements}\n"
        "</speak>"
    )
