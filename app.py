"""Hunter Podcast Studio - turn sales reports into a two-host podcast.

Run with:  streamlit run app.py
"""

import datetime
from pathlib import Path

import streamlit as st

from podcast_studio.audio import VOICE_PAIRS, synthesize_podcast
from podcast_studio.config import Settings
from podcast_studio.extractors import extract_text
from podcast_studio.script_writer import (
    editable_text_to_turns,
    generate_script,
    turns_to_editable_text,
)

EPISODES_DIR = Path(__file__).parent / "episodes"

FILE_ICONS = {
    ".pdf": "📕", ".docx": "📄", ".pptx": "📊",
    ".xlsx": "📈", ".xlsm": "📈",
    ".txt": "📝", ".md": "📝", ".csv": "📝", ".json": "📝",
}

PREVIEW_LINES = {
    "host1": "Hi, I'm {name}, and I'm excited for today's episode.",
    "host2": "And I'm {name}. Let's get right into it.",
}

st.set_page_config(page_title="Hunter Podcast Studio", page_icon="🎙️", layout="wide")

# --- Styling ------------------------------------------------------------------
st.markdown(
    """
    <style>
    .block-container { padding-top: 1.5rem; max-width: 1100px; }
    #MainMenu, footer,
    header[data-testid="stHeader"],
    div[data-testid="stToolbar"],
    div[data-testid="stDecoration"],
    div[data-testid="stStatusWidget"] { visibility: hidden; height: 0; }

    .hero {
        background: linear-gradient(120deg, #00552A 0%, #00843D 55%, #22A45D 100%);
        border-radius: 18px;
        padding: 2.2rem 2.5rem;
        color: white;
        margin-bottom: 1.4rem;
        box-shadow: 0 8px 24px rgba(0, 84, 42, .18);
    }
    .hero h1 { color: white; font-size: 2.1rem; margin: 0 0 .4rem 0; }
    .hero p { color: #E3F2E9; font-size: 1.05rem; margin: 0; max-width: 46rem; }
    .hero .badges { margin-top: .9rem; }
    .hero .badge {
        display: inline-block; background: rgba(255,255,255,.16);
        border: 1px solid rgba(255,255,255,.35); border-radius: 999px;
        padding: .18rem .75rem; font-size: .8rem; margin-right: .45rem;
    }

    /* Progress stepper */
    .stepper { display: flex; align-items: center; margin: .2rem 0 1.8rem 0; }
    .stepper .step { display: flex; align-items: center; gap: .55rem; }
    .stepper .step .label {
        font-weight: 600; font-size: .92rem; color: #9AA79E; white-space: nowrap;
    }
    .stepper .step.on .label, .stepper .step.done .label { color: #15291C; }
    .stepper .dot {
        width: 1.9rem; height: 1.9rem; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: .88rem; font-weight: 700;
        background: #EDF3EE; color: #9AA79E; border: 2px solid #EDF3EE;
        transition: all .25s ease;
    }
    .stepper .step.on .dot { background: white; color: #00843D; border-color: #00843D; }
    .stepper .step.done .dot { background: #00843D; color: white; border-color: #00843D; }
    .stepper .line { flex: 1; height: 2px; background: #DCE9E0; margin: 0 .9rem; }
    .stepper .line.done { background: #00843D; }

    .step-label {
        display: inline-flex; align-items: center; gap: .6rem;
        font-size: 1.25rem; font-weight: 700; color: #15291C;
        margin: .1rem 0 .9rem 0;
    }
    .step-label .num {
        background: #00843D; color: white; border-radius: 50%;
        width: 1.7rem; height: 1.7rem; display: inline-flex;
        align-items: center; justify-content: center;
        font-size: .95rem; font-weight: 700;
    }

    .file-chip-row { display: flex; flex-wrap: wrap; gap: .5rem; margin: .7rem 0 .2rem 0; }
    .file-chip {
        display: inline-flex; align-items: center; gap: .4rem;
        background: #F1F6F2; border: 1px solid #DCE9E0; border-radius: 10px;
        padding: .35rem .75rem; font-size: .85rem; color: #15291C;
    }

    .episode-card {
        background: linear-gradient(135deg, #F6FAF7 0%, #EEF6F0 100%);
        border: 1px solid #DCE9E0; border-radius: 16px;
        padding: 1.3rem 1.6rem; margin-bottom: 1rem;
    }
    .episode-card .eyebrow {
        text-transform: uppercase; letter-spacing: .06em; font-size: .72rem;
        font-weight: 700; color: #00843D; margin-bottom: .2rem;
    }
    .episode-card h3 { margin: 0 0 .3rem 0; color: #15291C; }
    .episode-card .hosts { color: #4C5F52; font-size: .92rem; }

    div[data-testid="stFileUploader"] section {
        border: 2px dashed #9CC7AC; border-radius: 14px; background: #F6FAF7;
    }
    .stButton button[kind="primary"] {
        border-radius: 10px; padding: .55rem 1.4rem; font-weight: 600;
        transition: transform .12s ease;
    }
    .stButton button[kind="primary"]:hover { transform: translateY(-1px); }
    div[data-testid="stMetric"] {
        background: #F1F6F2; border: 1px solid #DCE9E0;
        border-radius: 12px; padding: .7rem .9rem;
    }
    div[data-testid="stExpander"] { border-radius: 12px; border-color: #DCE9E0; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div class="hero">
      <h1>🎙️ Hunter Podcast Studio</h1>
      <p>Turn Marketing Activity Reports and sales documents into a professional
      two-host podcast for the team — upload, review the script, and press play.</p>
      <div class="badges">
        <span class="badge">Hunter Industries</span>
        <span class="badge">FX Luminaire</span>
        <span class="badge">Powered by Azure AI</span>
      </div>
    </div>
    """,
    unsafe_allow_html=True,
)

settings = Settings.from_env()


def file_icon(filename: str) -> str:
    return FILE_ICONS.get(Path(filename).suffix.lower(), "📄")


def get_voice_preview(voice_pair_name: str, host1_name: str, host2_name: str) -> bytes:
    cache = st.session_state.setdefault("voice_previews", {})
    if voice_pair_name not in cache:
        turns = [
            {"speaker": "host1", "text": PREVIEW_LINES["host1"].format(name=host1_name)},
            {"speaker": "host2", "text": PREVIEW_LINES["host2"].format(name=host2_name)},
        ]
        cache[voice_pair_name] = synthesize_podcast(settings, turns, voice_pair_name)
    return cache[voice_pair_name]


# --- Sidebar: configuration -------------------------------------------------
with st.sidebar:
    st.header("⚙️ Episode settings")
    length_mode = st.radio(
        "Episode length",
        ["Standard (20–24 min)", "Custom"],
        help="Standard scales within 20–24 minutes based on how much material there is. "
        "A length requested in the episode instructions always wins.",
    )
    target_minutes = None
    if length_mode == "Custom":
        target_minutes = st.slider("Target length (minutes)", 3, 30, 22)

    st.divider()
    voice_pair_name = st.selectbox("Host voices", list(VOICE_PAIRS.keys()))
    host1_name, host2_name = VOICE_PAIRS[voice_pair_name]["display"]
    st.caption(f"Your hosts: **{host1_name}** and **{host2_name}**")

    if st.button(
        "▶️ Preview these voices",
        use_container_width=True,
        disabled=settings.missing_speech(),
    ):
        with st.spinner("Generating a short voice sample..."):
            try:
                st.audio(
                    get_voice_preview(voice_pair_name, host1_name, host2_name),
                    format="audio/mp3",
                )
            except Exception as exc:
                st.error(f"Preview failed: {exc}")
    if settings.missing_speech():
        st.caption("Voice preview isn't available right now — contact your admin.")

# --- Progress stepper (rendered after step 1, once source_parts is known) ---
step2_done = "script_text" in st.session_state
step3_done = "audio" in st.session_state


def _step_class(done: bool, active: bool) -> str:
    if done:
        return "done"
    return "on" if active else ""


# --- Step 1: source material -------------------------------------------------
with st.container(border=True):
    st.markdown(
        '<div class="step-label"><span class="num">1</span> Add your source material</div>',
        unsafe_allow_html=True,
    )
    tab_upload, tab_paste = st.tabs(["📁 Upload files", "📋 Paste text"])
    with tab_upload:
        uploads = st.file_uploader(
            "Upload reports, MAR exports, decks — anything the episode should cover",
            type=["pdf", "docx", "pptx", "xlsx", "xlsm", "txt", "md", "csv", "json"],
            accept_multiple_files=True,
            label_visibility="collapsed",
        )
        if uploads:
            chips = "".join(
                f'<span class="file-chip">{file_icon(f.name)} <b>{f.name}</b> '
                f'· {len(f.getvalue()) / 1024:.0f} KB</span>'
                for f in uploads
            )
            st.markdown(f'<div class="file-chip-row">{chips}</div>', unsafe_allow_html=True)
    with tab_paste:
        pasted_text = st.text_area(
            "Paste MAR entries / emails / notes",
            height=160,
            placeholder="Paste raw MAR entries, report text, or anything else here...",
            label_visibility="collapsed",
        )

    extra_instructions = st.text_area(
        "Episode instructions (optional)",
        height=90,
        placeholder='e.g. "Focus on the Southwest region", "Keep it to 10 minutes", '
        '"Upbeat — this was a record quarter"',
    )

source_parts = []
if uploads:
    for f in uploads:
        text = extract_text(f.name, f.getvalue())
        source_parts.append(f"===== Document: {f.name} =====\n{text}")
if pasted_text.strip():
    source_parts.append("===== Pasted text =====\n" + pasted_text.strip())

if source_parts:
    st.caption(f"✅ {sum(len(p) for p in source_parts):,} characters of material loaded.")

# Render the stepper now that all three states are known.
step1_done = bool(source_parts)
s1 = _step_class(step1_done, True)
s2 = _step_class(step2_done, step1_done and not step2_done)
s3 = _step_class(step3_done, step2_done and not step3_done)
stepper_html = f"""
<div class="stepper">
  <div class="step {s1}"><div class="dot">{'✓' if step1_done else '1'}</div>
    <div class="label">Source material</div></div>
  <div class="line {'done' if step1_done else ''}"></div>
  <div class="step {s2}"><div class="dot">{'✓' if step2_done else '2'}</div>
    <div class="label">Script</div></div>
  <div class="line {'done' if step2_done else ''}"></div>
  <div class="step {s3}"><div class="dot">{'✓' if step3_done else '3'}</div>
    <div class="label">Podcast</div></div>
</div>
"""
# Move the stepper visually above step 1 by rendering it just under the hero.
st.markdown(stepper_html, unsafe_allow_html=True)

# --- Step 2: script ----------------------------------------------------------
with st.container(border=True):
    st.markdown(
        '<div class="step-label"><span class="num">2</span> Generate the script</div>',
        unsafe_allow_html=True,
    )

    if st.button(
        "✍️ Generate script", type="primary", disabled=not source_parts,
        use_container_width=True,
    ):
        if settings.missing_openai():
            st.error(
                "This tool isn't connected yet — please contact your admin to finish setup."
            )
        else:
            with st.status("Writing your episode...", expanded=True) as status:
                status.write(
                    f"Reading {sum(len(p) for p in source_parts):,} characters of "
                    "source material..."
                )
                try:
                    status.write(
                        "Drafting the script with Azure OpenAI — a full-length "
                        "episode can take a minute or two, longer if it needs "
                        "extending to hit 20–24 minutes."
                    )
                    script = generate_script(
                        settings,
                        source_text="\n\n".join(source_parts),
                        extra_instructions=extra_instructions,
                        target_minutes=target_minutes,
                        host1_name=host1_name,
                        host2_name=host2_name,
                    )
                    st.session_state["episode_title"] = script.get("title", "Sales Update")
                    st.session_state["script_text"] = turns_to_editable_text(
                        script, host1_name, host2_name
                    )
                    st.session_state.pop("audio", None)
                    status.update(
                        label=f"Script ready: \"{st.session_state['episode_title']}\"",
                        state="complete", expanded=False,
                    )
                except Exception as exc:
                    status.update(label="Script generation failed", state="error")
                    st.error(f"Script generation failed: {exc}")

    if not source_parts:
        st.info("Add at least one document or paste some text to enable script generation.")

    if "script_text" in st.session_state:
        st.session_state["episode_title"] = st.text_input(
            "Episode title", st.session_state["episode_title"]
        )
        st.session_state["script_text"] = st.text_area(
            "Script — edit freely, keep the 'Name: line' format",
            st.session_state["script_text"],
            height=420,
        )
        turns = editable_text_to_turns(
            st.session_state["script_text"], host1_name, host2_name
        )
        word_count = sum(len(t["text"].split()) for t in turns)
        m1, m2, m3 = st.columns(3)
        m1.metric("Dialogue turns", f"{len(turns)}")
        m2.metric("Words", f"{word_count:,}")
        m3.metric("Est. runtime", f"{word_count / 160:.0f} min")
    else:
        turns = []

# --- Step 3: audio ---------------------------------------------------------
if "script_text" in st.session_state:
    with st.container(border=True):
        st.markdown(
            '<div class="step-label"><span class="num">3</span> Produce the podcast</div>',
            unsafe_allow_html=True,
        )
        if st.button(
            "🎧 Generate podcast audio", type="primary", disabled=not turns,
            use_container_width=True,
        ):
            if settings.missing_speech():
                st.error(
                    "This tool isn't connected yet — please contact your admin to finish setup."
                )
            else:
                progress = st.progress(0.0, text="Synthesizing audio...")

                def on_progress(done, total):
                    progress.progress(
                        done / total,
                        text=f"Synthesizing part {min(done + 1, total)} of {total}...",
                    )

                try:
                    audio = synthesize_podcast(
                        settings, turns, voice_pair_name, progress_callback=on_progress
                    )
                    st.session_state["audio"] = audio
                    progress.empty()

                    EPISODES_DIR.mkdir(exist_ok=True)
                    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
                    safe_title = "".join(
                        c for c in st.session_state["episode_title"]
                        if c.isalnum() or c in " -_"
                    ).strip() or "episode"
                    base = EPISODES_DIR / f"{stamp} {safe_title}"
                    base.with_suffix(".mp3").write_bytes(audio)
                    base.with_suffix(".txt").write_text(
                        st.session_state["script_text"], encoding="utf-8"
                    )
                    st.session_state["saved_path"] = str(base.with_suffix(".mp3"))
                except Exception as exc:
                    progress.empty()
                    st.error(f"Audio generation failed: {exc}")

        if "audio" in st.session_state:
            runtime_min = word_count / 160 if turns else 0
            st.markdown(
                f"""
                <div class="episode-card">
                  <div class="eyebrow">Episode ready</div>
                  <h3>🎉 {st.session_state['episode_title']}</h3>
                  <div class="hosts">Hosted by {host1_name} &amp; {host2_name}
                    · ~{runtime_min:.0f} min · saved to
                    <code>{st.session_state['saved_path']}</code></div>
                </div>
                """,
                unsafe_allow_html=True,
            )
            st.audio(st.session_state["audio"], format="audio/mp3")
            col1, col2 = st.columns(2)
            col1.download_button(
                "⬇️ Download MP3",
                st.session_state["audio"],
                file_name=f"{st.session_state['episode_title']}.mp3",
                mime="audio/mpeg",
                use_container_width=True,
            )
            col2.download_button(
                "⬇️ Download script",
                st.session_state["script_text"],
                file_name=f"{st.session_state['episode_title']} - script.txt",
                mime="text/plain",
                use_container_width=True,
            )
