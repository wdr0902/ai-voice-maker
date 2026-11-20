import React, { useState } from "react";
import {
  AlertCircle,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Volume2,
} from "lucide-react";
import { generateDialogueVoice, generateSingleVoice } from "../lib/api";
import { base64ToBlob } from "../lib/audioUtils";
import type { VoiceMeta, VoiceName } from "../types";

interface VoiceStudioProps {
  folders: string[];
  onSaveAIVoice: (params: {
    blob: Blob;
    title: string;
    folder: string;
    transcript: string;
    voiceMeta: VoiceMeta;
  }) => Promise<void>;
}

const VOICES: Array<{ name: VoiceName; character: string }> = [
  { name: "Kore", character: "Warm, clear, composed" },
  { name: "Puck", character: "Bright, expressive, conversational" },
  { name: "Charon", character: "Deep, grounded, authoritative" },
  { name: "Fenrir", character: "Rich, steady, documentary" },
  { name: "Zephyr", character: "Airy, agile, upbeat" },
];

interface DialogueLine {
  id: string;
  speaker: "A" | "B";
  text: string;
}

export const VoiceStudio: React.FC<VoiceStudioProps> = ({
  folders,
  onSaveAIVoice,
}) => {
  const [mode, setMode] = useState<"single" | "dialogue">("single");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState(
    folders.includes("AI Voices") ? "AI Voices" : folders[0] || "General"
  );

  // Single speaker state
  const [voiceA, setVoiceA] = useState<VoiceName>("Kore");
  const [styleA, setStyleA] = useState("");
  const [scriptText, setScriptText] = useState("");

  // Dialogue state
  const [speakerAName, setSpeakerAName] = useState("Alex");
  const [speakerBName, setSpeakerBName] = useState("Sam");
  const [voiceB, setVoiceB] = useState<VoiceName>("Puck");
  const [styleB, setStyleB] = useState("");
  const [lines, setLines] = useState<DialogueLine[]>([
    {
      id: "l1",
      speaker: "A",
      text: "Welcome back! <breath> Let's walk through the key ideas from today's session.",
    },
    {
      id: "l2",
      speaker: "B",
      text: "|yeah| We captured three major breakthroughs worth turning into an audio brief.",
    },
  ]);

  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addDialogueLine = () => {
    const last = lines[lines.length - 1];
    const nextSpeaker: "A" | "B" = last?.speaker === "A" ? "B" : "A";
    setLines((prev) => [
      ...prev,
      { id: `l_${Date.now()}`, speaker: nextSpeaker, text: "" },
    ]);
  };

  const updateLine = (id: string, patch: Partial<DialogueLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const appendCueToLine = (id: string, cue: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, text: l.text ? `${l.text} ${cue}` : cue } : l
      )
    );
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleGenerate = async () => {
    setErrorMsg(null);
    setGenerating(true);

    try {
      if (mode === "single") {
        if (!scriptText.trim()) {
          throw new Error("Please enter a script or narration text first.");
        }
        const { audioBase64, mimeType } = await generateSingleVoice({
          text: scriptText.trim(),
          voiceName: voiceA,
          style: styleA.trim() || undefined,
        });
        const blob = base64ToBlob(audioBase64, mimeType || "audio/wav");
        const autoTitle =
          title.trim() ||
          `AI Voice (${voiceA}) — ${scriptText.trim().slice(0, 36)}${
            scriptText.trim().length > 36 ? "..." : ""
          }`;

        await onSaveAIVoice({
          blob,
          title: autoTitle,
          folder,
          transcript: scriptText.trim(),
          voiceMeta: {
            mode: "single",
            voiceA,
            styleA: styleA.trim() || undefined,
          },
        });
        setTitle("");
        setScriptText("");
      } else {
        const cleanA = speakerAName.trim() || "Speaker A";
        const cleanB = speakerBName.trim() || "Speaker B";
        const nonEmpty = lines.filter((l) => l.text.trim().length > 0);
        if (nonEmpty.length === 0) {
          throw new Error("Add at least one spoken dialogue line.");
        }

        const payloadLines = nonEmpty.map((l) => ({
          speaker: l.speaker === "A" ? cleanA : cleanB,
          text: l.text.trim(),
        }));

        const { audioBase64, mimeType } = await generateDialogueVoice({
          lines: payloadLines,
          speakerA: {
            name: cleanA,
            voiceName: voiceA,
            style: styleA.trim() || undefined,
          },
          speakerB: {
            name: cleanB,
            voiceName: voiceB,
            style: styleB.trim() || undefined,
          },
        });

        const blob = base64ToBlob(audioBase64, mimeType || "audio/wav");
        const fullTranscript = payloadLines
          .map((l) => `${l.speaker}: ${l.text}`)
          .join("\n\n");

        const autoTitle =
          title.trim() || `AI Dialogue (${cleanA} & ${cleanB})`;

        await onSaveAIVoice({
          blob,
          title: autoTitle,
          folder,
          transcript: fullTranscript,
          voiceMeta: {
            mode: "dialogue",
            voiceA,
            voiceB,
            styleA: styleA.trim() || undefined,
            styleB: styleB.trim() || undefined,
          },
        });
        setTitle("");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to generate AI voice recording."
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            AI Voice Studio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Synthesize unlimited single-voice narrations or dual-speaker dialogues and save them straight to your recordings vault.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              mode === "single"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            Single Voice
          </button>
          <button
            type="button"
            onClick={() => setMode("dialogue")}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              mode === "dialogue"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Dual Dialogue
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-800 dark:text-red-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <label
              htmlFor="tts-title"
              className="text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Recording Title
            </label>
            <input
              id="tts-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Product Launch Intro or Podcast Episode 1"
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="tts-folder"
              className="text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Save to Folder
            </label>
            <select
              id="tts-folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            >
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        {mode === "single" ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="voice-a-select"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Voice Persona
                </label>
                <select
                  id="voice-a-select"
                  value={voiceA}
                  onChange={(e) => setVoiceA(e.target.value as VoiceName)}
                  className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                >
                  {VOICES.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} — {v.character}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="voice-a-style"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Delivery Direction (optional)
                </label>
                <input
                  id="voice-a-style"
                  type="text"
                  value={styleA}
                  onChange={(e) => setStyleA(e.target.value)}
                  placeholder="e.g., Calm documentary narrator, energetic host"
                  className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="single-script"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Script to Record
                </label>
                <span className="font-mono text-xs tabular-nums text-slate-400">
                  {scriptText.length} chars
                </span>
              </div>
              <textarea
                id="single-script"
                rows={7}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder="Write or paste anything you want recorded as an AI voice track..."
                className="w-full p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 flex flex-col gap-3">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Speaker A
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={speakerAName}
                    onChange={(e) => setSpeakerAName(e.target.value)}
                    placeholder="Name"
                    aria-label="Speaker A Name"
                    className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                  />
                  <select
                    value={voiceA}
                    onChange={(e) => setVoiceA(e.target.value as VoiceName)}
                    aria-label="Speaker A Voice"
                    className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {VOICES.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={styleA}
                  onChange={(e) => setStyleA(e.target.value)}
                  placeholder="Style (e.g., Enthusiastic host)"
                  aria-label="Speaker A Style"
                  className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 flex flex-col gap-3">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Speaker B
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={speakerBName}
                    onChange={(e) => setSpeakerBName(e.target.value)}
                    placeholder="Name"
                    aria-label="Speaker B Name"
                    className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                  />
                  <select
                    value={voiceB}
                    onChange={(e) => setVoiceB(e.target.value as VoiceName)}
                    aria-label="Speaker B Voice"
                    className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {VOICES.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={styleB}
                  onChange={(e) => setStyleB(e.target.value)}
                  placeholder="Style (e.g., Curious co-host)"
                  aria-label="Speaker B Style"
                  className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Dialogue Turns (supports cues like &lt;laugh&gt;, &lt;breath&gt;, |yeah|, |mhm|)
                </span>
                <button
                  type="button"
                  onClick={addDialogueLine}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Turn
                </button>
              </div>

              {lines.map((line) => (
                <div
                  key={line.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/40 dark:bg-slate-950/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateLine(line.id, {
                            speaker: line.speaker === "A" ? "B" : "A",
                          })
                        }
                        className="h-7 px-2.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {line.speaker === "A"
                          ? speakerAName || "Speaker A"
                          : speakerBName || "Speaker B"}
                      </button>
                      <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500">
                        {["<breath>", "<laugh>", "|yeah|", "|mhm|"].map((cue) => (
                          <button
                            key={cue}
                            type="button"
                            onClick={() => appendCueToLine(line.id, cue)}
                            className="px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 font-mono text-[11px] cursor-pointer"
                          >
                            +{cue}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length <= 1}
                      aria-label="Remove line"
                      className="text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={line.text}
                    onChange={(e) => updateLine(line.id, { text: e.target.value })}
                    placeholder="Enter spoken line..."
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating AI Voice...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate & Save to Vault
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
