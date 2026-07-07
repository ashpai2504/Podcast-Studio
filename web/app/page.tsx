"use client";

import { useRef, useState } from "react";
import { extractText } from "@/lib/extract";
import { computeLengthTarget, mentionsLength, wordCount } from "@/lib/scriptPrompt";
import { editableTextToTurns, turnsToEditableText } from "@/lib/scriptText";
import { chunkTurns } from "@/lib/ssml";
import type { Script, Turn } from "@/lib/types";
import { DEFAULT_VOICE_PAIR, VOICE_PAIRS } from "@/lib/voices";

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.pptx,.xlsx,.xlsm,.txt,.md,.csv,.json";

const FILE_ICONS: Record<string, string> = {
  ".pdf": "📕",
  ".docx": "📄",
  ".pptx": "📊",
  ".xlsx": "📈",
  ".xlsm": "📈",
  ".txt": "📝",
  ".md": "📝",
  ".csv": "📝",
  ".json": "📝",
};

function fileIcon(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return FILE_ICONS[ext] ?? "📄";
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: "loading" | "done" | "error";
  text: string;
}

type GenState = "idle" | "working" | "done" | "error";

export default function Home() {
  // --- Source material ---
  const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Episode settings ---
  const [lengthMode, setLengthMode] = useState<"standard" | "custom">("standard");
  const [customMinutes, setCustomMinutes] = useState(22);
  const [voicePairName, setVoicePairName] = useState(DEFAULT_VOICE_PAIR);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // --- Script ---
  const [script, setScript] = useState<Script | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [scriptGenState, setScriptGenState] = useState<GenState>("idle");
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [scriptError, setScriptError] = useState<string | null>(null);

  // --- Audio ---
  const [audioGenState, setAudioGenState] = useState<GenState>("idle");
  const [audioProgress, setAudioProgress] = useState({ done: 0, total: 0 });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const targetMinutes = lengthMode === "standard" ? null : customMinutes;
  const pair = VOICE_PAIRS[voicePairName];
  const [host1Name, host2Name] = pair.display;

  const sourceParts = [
    ...uploaded
      .filter((f) => f.status === "done" && f.text.trim())
      .map((f) => `===== Document: ${f.name} =====\n${f.text}`),
    ...(pastedText.trim() ? [`===== Pasted text =====\n${pastedText.trim()}`] : []),
  ];
  const sourceCharCount = sourceParts.reduce((sum, p) => sum + p.length, 0);
  const anyFileLoading = uploaded.some((f) => f.status === "loading");
  const canGenerateScript =
    sourceParts.length > 0 && !anyFileLoading && scriptGenState !== "working";

  const turns = script ? editableTextToTurns(scriptText, host1Name, host2Name) : [];
  const scriptWordCount = wordCount(turns);

  const step1Done = sourceParts.length > 0;
  const step2Done = script !== null;
  const step3Done = audioUrl !== null;

  function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploaded((prev) => [
        ...prev,
        { id, name: file.name, size: file.size, status: "loading", text: "" },
      ]);
      extractText(file).then((text) => {
        setUploaded((prev) => prev.map((f) => (f.id === id ? { ...f, status: "done", text } : f)));
      });
    }
  }

  function removeFile(id: string) {
    setUploaded((prev) => prev.filter((f) => f.id !== id));
  }

  async function handlePreviewVoice() {
    if (previewUrls[voicePairName]) return;
    setPreviewState("loading");
    try {
      const previewTurns: Turn[] = [
        { speaker: "host1", text: `Hi, I'm ${host1Name}, and I'm excited for today's episode.` },
        { speaker: "host2", text: `And I'm ${host2Name}. Let's get right into it.` },
      ];
      const res = await fetch("/api/audio/synthesize-chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: previewTurns, voicePairName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Preview failed.");
      }
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      setPreviewUrls((prev) => ({ ...prev, [voicePairName]: url }));
      setPreviewState("idle");
    } catch {
      setPreviewState("error");
    }
  }

  async function handleGenerateScript() {
    setScriptGenState("working");
    setScriptError(null);
    setStatusLog([`Reading ${sourceCharCount.toLocaleString()} characters of source material...`]);
    const sourceText = sourceParts.join("\n\n");
    try {
      setStatusLog((log) => [
        ...log,
        "Drafting the script with Azure OpenAI - a full-length episode can take a minute " +
          "or two, longer if it needs extending to hit 20-24 minutes.",
      ]);
      const draftRes = await fetch("/api/script/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, extraInstructions, targetMinutes, host1Name, host2Name }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || "Script generation failed.");
      let current: Script = draftData.script;

      const { minWords } = computeLengthTarget(targetMinutes);
      const lengthOverridden = targetMinutes === null && mentionsLength(extraInstructions);
      if (!lengthOverridden) {
        for (let i = 0; i < 3; i++) {
          const words = wordCount(current.turns);
          if (words >= minWords) break;
          setStatusLog((log) => [
            ...log,
            `Only ${words.toLocaleString()} words so far - extending toward ${minWords.toLocaleString()}...`,
          ]);
          const contRes = await fetch("/api/script/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceText,
              extraInstructions,
              targetMinutes,
              host1Name,
              host2Name,
              script: current,
            }),
          });
          const contData = await contRes.json();
          if (!contRes.ok) throw new Error(contData.error || "Script continuation failed.");
          current = contData.script;
        }
      }
      setScript(current);
      setEpisodeTitle(current.title);
      setScriptText(turnsToEditableText(current, host1Name, host2Name));
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setAudioGenState("idle");
      setStatusLog((log) => [...log, `Script ready: "${current.title}"`]);
      setScriptGenState("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Script generation failed.";
      setScriptError(message);
      setStatusLog((log) => [...log, `Error: ${message}`]);
      setScriptGenState("error");
    }
  }

  async function handleGenerateAudio() {
    const currentTurns = editableTextToTurns(scriptText, host1Name, host2Name);
    if (!currentTurns.length) return;
    setAudioGenState("working");
    setAudioError(null);
    const chunks = chunkTurns(currentTurns);
    setAudioProgress({ done: 0, total: chunks.length });
    try {
      const buffers: ArrayBuffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        let ok = false;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const res = await fetch("/api/audio/synthesize-chunk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ turns: chunks[i], voicePairName }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Synthesis failed on part ${i + 1} of ${chunks.length}.`);
            }
            buffers.push(await res.arrayBuffer());
            ok = true;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!ok) throw lastErr instanceof Error ? lastErr : new Error("Audio synthesis failed.");
        setAudioProgress({ done: i + 1, total: chunks.length });
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const blob = new Blob(buffers, { type: "audio/mpeg" });
      setAudioUrl(URL.createObjectURL(blob));
      setAudioGenState("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Audio generation failed.";
      setAudioError(message);
      setAudioGenState("error");
    }
  }

  function downloadScript() {
    const blob = new Blob([scriptText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${episodeTitle || "episode"} - script.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleStartOver() {
    setUploaded([]);
    setPastedText("");
    setExtraInstructions("");
    setScript(null);
    setEpisodeTitle("");
    setScriptText("");
    setScriptGenState("idle");
    setStatusLog([]);
    setScriptError(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioGenState("idle");
    setAudioError(null);
  }

  return (
    <>
      <div className="hero">
        <h1>🎙️ Hunter Podcast Studio</h1>
        <p>
          Turn Marketing Activity Reports and sales documents into a professional
          two-host podcast for the team — upload, review the script, and press play.
        </p>
        <div className="badges">
          <span className="badge">Hunter Industries</span>
          <span className="badge">FX Luminaire</span>
          <span className="badge">Powered by Azure AI</span>
        </div>
      </div>

      <div className="stepper">
        <div className={`step ${step1Done ? "done" : "on"}`}>
          <div className="dot">{step1Done ? "✓" : "1"}</div>
          <div className="label">Source material</div>
        </div>
        <div className={`line ${step1Done ? "done" : ""}`} />
        <div className={`step ${step2Done ? "done" : step1Done ? "on" : ""}`}>
          <div className="dot">{step2Done ? "✓" : "2"}</div>
          <div className="label">Script</div>
        </div>
        <div className={`line ${step2Done ? "done" : ""}`} />
        <div className={`step ${step3Done ? "done" : step2Done ? "on" : ""}`}>
          <div className="dot">{step3Done ? "✓" : "3"}</div>
          <div className="label">Podcast</div>
        </div>
      </div>

      {/* Step 1 */}
      <div className="card">
        <div className="step-label">
          <span className="num">1</span> Add your source material
        </div>

        <div className="tabs">
          <button className={activeTab === "upload" ? "active" : ""} onClick={() => setActiveTab("upload")}>
            📁 Upload files
          </button>
          <button className={activeTab === "paste" ? "active" : ""} onClick={() => setActiveTab("paste")}>
            📋 Paste text
          </button>
        </div>

        {activeTab === "upload" && (
          <>
            <div
              className={`dropzone${dragOver ? " drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div>📤 Drop reports, MAR exports, decks here, or click to browse</div>
              <div style={{ fontSize: "0.8rem", marginTop: "0.3rem" }}>
                PDF, Word, PowerPoint, Excel, or plain text
              </div>
            </div>
            {uploaded.length > 0 && (
              <div className="file-chip-row">
                {uploaded.map((f) => (
                  <span key={f.id} className="file-chip">
                    {fileIcon(f.name)} <b>{f.name}</b> · {(f.size / 1024).toFixed(0)} KB
                    {f.status === "loading" && " · reading…"}
                    {f.status === "error" && " · error"}
                    <button onClick={() => removeFile(f.id)} title="Remove">
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "paste" && (
          <textarea
            rows={7}
            placeholder="Paste raw MAR entries, report text, or anything else here..."
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />
        )}

        <div style={{ marginTop: "1rem" }}>
          <label className="field-label">Episode instructions (optional)</label>
          <textarea
            rows={3}
            placeholder='e.g. "Focus on the Southwest region", "Keep it to 10 minutes", "Upbeat — this was a record quarter"'
            value={extraInstructions}
            onChange={(e) => setExtraInstructions(e.target.value)}
          />
        </div>

        {sourceParts.length > 0 && (
          <p style={{ marginTop: "0.8rem", fontSize: "0.88rem", color: "var(--text-muted)" }}>
            ✅ {sourceCharCount.toLocaleString()} characters of material loaded.
          </p>
        )}
      </div>

      {/* Step 2 */}
      <div className="card">
        <div className="step-label">
          <span className="num">2</span> Generate the script
        </div>

        <div className="settings-grid">
          <div>
            <label className="field-label">Episode length</label>
            <select value={lengthMode} onChange={(e) => setLengthMode(e.target.value as "standard" | "custom")}>
              <option value="standard">Standard (20–24 min)</option>
              <option value="custom">Custom</option>
            </select>
            {lengthMode === "custom" && (
              <input
                type="number"
                min={3}
                max={30}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Number(e.target.value))}
                style={{ marginTop: "0.5rem" }}
              />
            )}
          </div>
          <div>
            <label className="field-label">Host voices</label>
            <select value={voicePairName} onChange={(e) => setVoicePairName(e.target.value)} disabled={script !== null}>
              {Object.keys(VOICE_PAIRS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              onClick={handlePreviewVoice}
              disabled={previewState === "loading" || script !== null}
              type="button"
              style={{ marginTop: "0.5rem" }}
            >
              {previewState === "loading" ? "Generating…" : "▶️ Preview voices"}
            </button>
            {previewUrls[voicePairName] && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls src={previewUrls[voicePairName]} style={{ marginTop: "0.5rem" }} />
            )}
          </div>
        </div>

        <button className="btn btn-primary btn-block" onClick={handleGenerateScript} disabled={!canGenerateScript}>
          ✍️ Generate script
        </button>

        {!step1Done && (
          <div className="alert alert-info">
            Add at least one document or paste some text to enable script generation.
          </div>
        )}

        {statusLog.length > 0 && (
          <div className="status-box">
            {statusLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        {scriptError && <div className="alert alert-error">{scriptError}</div>}

        {script && (
          <>
            <div style={{ marginTop: "1.2rem" }}>
              <label className="field-label">Episode title</label>
              <input type="text" value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)} />
            </div>
            <div style={{ marginTop: "1rem" }}>
              <label className="field-label">Script — edit freely, keep the &apos;Name: line&apos; format</label>
              <textarea rows={16} value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
            </div>
            <div className="metric-row">
              <div className="metric">
                <div className="metric-label">Dialogue turns</div>
                <div className="metric-value">{turns.length}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Words</div>
                <div className="metric-value">{scriptWordCount.toLocaleString()}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Est. runtime</div>
                <div className="metric-value">{Math.round(scriptWordCount / 160)} min</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Step 3 */}
      {script && (
        <div className="card">
          <div className="step-label">
            <span className="num">3</span> Produce the podcast
          </div>

          <button
            className="btn btn-primary btn-block"
            onClick={handleGenerateAudio}
            disabled={turns.length === 0 || audioGenState === "working"}
          >
            🎧 Generate podcast audio
          </button>

          {audioGenState === "working" && (
            <div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${audioProgress.total ? (audioProgress.done / audioProgress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Synthesizing part {Math.min(audioProgress.done + 1, audioProgress.total)} of{" "}
                {audioProgress.total}…
              </p>
            </div>
          )}
          {audioError && <div className="alert alert-error">{audioError}</div>}

          {audioUrl && (
            <>
              <div className="episode-card">
                <div className="eyebrow">Episode ready</div>
                <h3>🎉 {episodeTitle}</h3>
                <div className="hosts">
                  Hosted by {host1Name} &amp; {host2Name} · ~{Math.round(scriptWordCount / 160)} min
                </div>
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={audioUrl} />
              <div className="download-row">
                <a className="btn btn-block" href={audioUrl} download={`${episodeTitle || "episode"}.mp3`}>
                  ⬇️ Download MP3
                </a>
                <button className="btn btn-block" onClick={downloadScript} type="button">
                  ⬇️ Download script
                </button>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.6rem" }}>
                Nothing is stored on the server — download the MP3 and script now to keep them.
              </p>
            </>
          )}
        </div>
      )}

      {(uploaded.length > 0 || pastedText || script) && (
        <button className="btn" onClick={handleStartOver} style={{ marginTop: "0.5rem" }} type="button">
          🔄 Start a new episode
        </button>
      )}
    </>
  );
}
