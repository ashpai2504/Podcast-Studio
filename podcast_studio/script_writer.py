"""Generate a two-host podcast dialogue script from source documents via Azure OpenAI."""

import json
import re

from openai import AzureOpenAI

from .config import Settings

SYSTEM_PROMPT = """\
You are the producer of an internal podcast for the sales organization at Hunter Industries \
and FX Luminaire. Each episode turns Marketing Activity Reports (MARs), sales reports, and \
other field documents into an engaging two-host conversation, so employees can listen and \
quickly understand what happened across the sales team.

Your job is to SYNTHESIZE the source material into a natural podcast dialogue - not to coach \
the team. Never add coaching commentary, prescriptive advice, or critique of sales behavior \
unless the source material itself explicitly contains it.

Episode structure:
1. A short, warm cold-open where the hosts greet listeners and preview the episode.
2. A high-level overview segment: light trend insights such as commonly referenced products, \
repeated activity types (ride-alongs, contractor visits, trainings, distributor meetings), \
customer segments, or regional patterns.
3. The main segment: walk through the field activity, grouped sensibly (by sales owner, \
region, or theme - whatever the material supports). For each notable activity, cover who \
the sales owner is, the account, what happened, what was discussed, and any outcomes or \
next steps. Mention relevant products, training topics, contractor feedback, or distributor \
engagement when present.
4. A brief wrap-up where the hosts recap the two or three biggest takeaways and sign off.

Dialogue style:
- Sound like a professional, friendly podcast (think NotebookLM) - two colleagues genuinely \
discussing the material, trading observations, asking each other short questions, and \
reacting naturally. Not two people reading alternating paragraphs.
- Keep turns conversational: mostly 1-4 sentences each. Vary the rhythm.
- Stay factual and grounded in the source material. Do not invent numbers, accounts, names, \
or outcomes that are not in the documents. If something is unclear in the source, either \
skip it or phrase it tentatively.
- Spell out numbers, acronyms and abbreviations the way a person would say them aloud \
(e.g. "MAR" as "M-A-R", "Q2" as "second quarter") since this script is fed directly to \
text-to-speech.
- Friendly, professional, and efficient tone. A helpful pair of teammates summarizing field \
activity so sales leaders and teammates can quickly understand what happened.

Output format:
Respond with ONLY a JSON object, no markdown fences, in exactly this shape:
{
  "title": "Episode title",
  "turns": [
    {"speaker": "host1", "text": "..."},
    {"speaker": "host2", "text": "..."}
  ]
}
"speaker" must be exactly "host1" or "host2". host1 opens the show, and the speakers must \
strictly alternate turn by turn.
"""


def generate_script(
    settings: Settings,
    source_text: str,
    extra_instructions: str,
    target_minutes: int | None,
    host1_name: str,
    host2_name: str,
) -> dict:
    """Return {"title": str, "turns": [{"speaker": "host1"|"host2", "text": str}, ...]}.

    target_minutes=None means the standard episode length: 20-24 minutes, scaled to
    how much substance the source material contains.
    """
    client = AzureOpenAI(
        azure_endpoint=settings.openai_endpoint,
        api_key=settings.openai_api_key,
        api_version=settings.openai_api_version,
    )

    # The HD voices speak at ~160 words per minute (measured, not the usual 140).
    if target_minutes is None:
        min_words, max_words = 3300, 3900  # 20-24 minutes
        length_instruction = (
            "Write a full-length episode of 20 to 24 minutes of audio. The voices speak at "
            f"about 160 words per minute, so the dialogue MUST total between {min_words:,} "
            f"and {max_words:,} words - treat {min_words:,} words as a hard minimum. Go "
            "deeper on the activities rather than padding. If the producer's instructions "
            "below explicitly ask for a shorter or longer episode, follow those instead."
        )
    else:
        target = target_minutes * 160
        min_words, max_words = int(target * 0.85), int(target * 1.2)
        length_instruction = (
            f"Write an episode of roughly {target:,} words (about {target_minutes} minutes "
            f"of audio at the voices' ~160 words-per-minute speaking pace)."
        )

    user_parts = [
        "Create a podcast episode script. " + length_instruction,
        f'The hosts are "{host1_name}" (host1) and "{host2_name}" (host2) - have them '
        f"address each other by these names.",
    ]
    if extra_instructions.strip():
        user_parts.append(
            "Additional instructions from the producer:\n" + extra_instructions.strip()
        )
    user_parts.append("=== SOURCE MATERIAL ===\n" + source_text.strip())
    user_parts.append("Remember: respond with the JSON object only.")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]
    script = _request_script(client, settings, messages)

    # Producer instructions may legitimately override the length, so only enforce the
    # minimum when the producer didn't ask for a specific length themselves.
    length_overridden = target_minutes is None and _mentions_length(extra_instructions)
    if not length_overridden:
        for _ in range(3):
            words = sum(len(t["text"].split()) for t in script["turns"])
            if words >= min_words:
                break
            script = _extend_script(client, settings, messages, script, min_words, max_words)
    return script


def _extend_script(
    client: AzureOpenAI,
    settings: Settings,
    base_messages: list,
    script: dict,
    min_words: int,
    max_words: int,
) -> dict:
    """Ask the model to CONTINUE a too-short episode rather than rewrite it.

    Models reliably produce additional content but tend to compress when asked to
    re-output an expanded full script. We drop the existing wrap-up, request new
    main-segment turns plus a fresh wrap-up, and splice them on.
    """
    turns = script["turns"]
    kept = turns[:-4] if len(turns) > 8 else turns  # drop the old wrap-up
    kept_words = sum(len(t["text"].split()) for t in kept)
    needed = max(min_words - kept_words, 600)
    next_speaker = "host2" if kept[-1]["speaker"] == "host1" else "host1"

    messages = base_messages + [
        {"role": "assistant", "content": json.dumps({"title": script["title"], "turns": kept})},
        {
            "role": "user",
            "content": (
                f"The episode so far is too short ({kept_words:,} words; the total must "
                f"reach {min_words:,}-{max_words:,}). Continue it with at least "
                f"{needed:,} more words of dialogue: cover activities, accounts, and "
                "product details from the source material that have not been discussed "
                "yet, then finish with a brief wrap-up and sign-off. The first new turn "
                f'must be "{next_speaker}" and speakers must strictly alternate. Respond '
                'with ONLY a JSON object of the NEW turns to append, in the form '
                '{"turns": [{"speaker": "...", "text": "..."}]} - do not repeat earlier turns.'
            ),
        },
    ]
    more = _request_script(client, settings, messages)
    return {"title": script["title"], "turns": kept + more["turns"]}


def _mentions_length(extra_instructions: str) -> bool:
    """True if the producer's instructions ask for a specific episode length."""
    return bool(
        re.search(r"\b(minutes?|mins?|shorter?|longer?|brief|quick|short|long)\b",
                  extra_instructions, re.IGNORECASE)
    )


def _request_script(client: AzureOpenAI, settings: Settings, messages: list) -> dict:
    response = client.chat.completions.create(
        model=settings.openai_deployment,
        messages=messages,
        response_format={"type": "json_object"},
    )
    script = _parse_script(response.choices[0].message.content)
    if not script.get("turns"):
        raise ValueError("The model returned a script with no dialogue turns.")
    return script


def _parse_script(raw: str) -> dict:
    """Parse the model output, tolerating stray text around the JSON object."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


def turns_to_editable_text(script: dict, host1_name: str, host2_name: str) -> str:
    """Render the script as 'Name: line' text the user can edit in the UI."""
    names = {"host1": host1_name, "host2": host2_name}
    lines = []
    for turn in script["turns"]:
        name = names.get(turn["speaker"], turn["speaker"])
        lines.append(f"{name}: {turn['text'].strip()}")
    return "\n\n".join(lines)


def editable_text_to_turns(text: str, host1_name: str, host2_name: str) -> list[dict]:
    """Parse edited 'Name: line' text back into speaker turns."""
    speakers = {host1_name.lower(): "host1", host2_name.lower(): "host2"}
    turns: list[dict] = []
    for block in text.split("\n"):
        line = block.strip()
        if not line:
            continue
        match = re.match(r"^([^:]{1,40}):\s*(.+)$", line, re.DOTALL)
        speaker = speakers.get(match.group(1).strip().lower()) if match else None
        if speaker:
            turns.append({"speaker": speaker, "text": match.group(2).strip()})
        elif turns:
            # Continuation line of the previous speaker's turn.
            turns[-1]["text"] += " " + line
    return turns
