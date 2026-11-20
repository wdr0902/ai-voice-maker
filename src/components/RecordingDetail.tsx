import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckSquare,
  Copy,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Star,
  Trash2,
  Volume2,
  Wand2,
} from "lucide-react";
import {
  askRecordings,
  generateSingleVoice,
  transformTranscript,
} from "../lib/api";
import {
  base64ToBlob,
  downloadBlob,
  downloadText,
  formatBytes,
  formatDuration,
  formatRelativeDate,
  generateId,
  getExtensionForMime,
} from "../lib/audioUtils";
import type {
  ChatMessage,
  RecordingMeta,
  TransformEntry,
  VoiceMeta,
  VoiceName,
} from "../types";
import { WaveformPlayer } from "./WaveformPlayer";

interface RecordingDetailProps {
  recording: RecordingMeta;
  audioBlob: Blob | null;
  folders: string[];
  onUpdate: (updated: RecordingMeta) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRetranscribe: (recording: RecordingMeta) => Promise<void>;
  onRegenerateAnalysis: (recording: RecordingMeta) => Promise<void>;
  onSaveAIVoiceFromText: (params: {
    blob: Blob;
    title: string;
    folder: string;
    transcript: string;
    voiceMeta: VoiceMeta;
  }) => Promise<void>;
}

type DetailTab = "transcript" | "notes" | "transform" | "ask";

const TRANSFORM_MODES = [
  { id: "cleanup", label: "Clean Prose" },
  { id: "email", label: "Executive Email" },
  { id: "minutes", label: "Meeting Minutes" },
  { id: "outline", label: "Structured Outline" },
  { id: "article", label: "Article Draft" },
];

const VOICES: VoiceName[] = ["Kore", "Puck", "Charon", "Fenrir", "Zephyr"];

export const RecordingDetail: React.FC<RecordingDetailProps> = ({
  recording,
  audioBlob,
  folders,
  onUpdate,
  onDelete,
  onRetranscribe,
  onRegenerateAnalysis,
  onSaveAIVoiceFromText,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>("transcript");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(recording.title);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState(recording.transcript);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Transform state
  const [customPrompt, setCustomPrompt] = useState("");
  const [transformLoading, setTransformLoading] = useState<string | null>(null);
  const [transformError, setTransformError] = useState<string | null>(null);

  // Ask state
  const [question, setQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // AI Voice Readback state
  const [ttsVoice, setTtsVoice] = useState<VoiceName>("Kore");
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  useEffect(() => {
    setTitleDraft(recording.title);
    setTranscriptDraft(recording.transcript);
    setEditingTitle(false);
    setEditingTranscript(false);
    setConfirmDelete(false);
    setTransformError(null);
    setAskError(null);
    setTtsError(null);
  }, [recording.id, recording.title, recording.transcript]);

  const saveTitle = async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === recording.title) {
      setTitleDraft(recording.title);
      return;
    }
    await onUpdate({ ...recording, title: trimmed });
  };

  const saveTranscript = async () => {
    setEditingTranscript(false);
    if (transcriptDraft === recording.transcript) return;
    await onUpdate({
      ...recording,
      transcript: transcriptDraft,
      transcriptionStatus: transcriptDraft.trim() ? "done" : "idle",
    });
  };

  const toggleActionItem = async (itemId: string) => {
    if (!recording.analysis) return;
    const nextItems = recording.analysis.actionItems.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    await onUpdate({
      ...recording,
      analysis: { ...recording.analysis, actionItems: nextItems },
    });
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleExportMarkdown = () => {
    const lines: string[] = [
      `# ${recording.title}`,
      "",
      `- **Date**: ${new Date(recording.createdAt).toLocaleString()}`,
      `- **Duration**: ${formatDuration(recording.durationSec)}`,
      `- **Folder**: ${recording.folder}`,
      `- **Source**: ${
        recording.kind === "ai-voice"
          ? "AI Voice Synthesis"
          : recording.kind === "uploaded"
          ? "Imported Audio"
          : "Microphone Recording"
      }`,
      "",
    ];

    if (recording.analysis) {
      lines.push("## Summary", "", recording.analysis.tldr, "");
      if (recording.analysis.keyPoints.length > 0) {
        lines.push("## Key Takeaways", "");
        recording.analysis.keyPoints.forEach((p) => lines.push(`- ${p}`));
        lines.push("");
      }
      if (recording.analysis.actionItems.length > 0) {
        lines.push("## Action Items", "");
        recording.analysis.actionItems.forEach((a) =>
          lines.push(`- [${a.done ? "x" : " "}] ${a.text}`)
        );
        lines.push("");
      }
    }

    lines.push("## Transcript", "", recording.transcript || "_No transcript available._", "");
    const safeSlug = recording.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    downloadText(lines.join("\n"), `${safeSlug || "recording"}.md`);
  };

  const handleDownloadAudio = () => {
    if (!audioBlob) return;
    const ext = getExtensionForMime(recording.mimeType || audioBlob.type);
    const safeSlug = recording.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    downloadBlob(audioBlob, `${safeSlug || "recording"}.${ext}`);
  };

  const handleRunTransform = async (mode: string, label: string, promptOverride?: string) => {
    if (!recording.transcript.trim()) {
      setTransformError("Transcribe the recording first before running a transform.");
      return;
    }
    setTransformError(null);
    setTransformLoading(mode);
    try {
      const output = await transformTranscript(
        recording.transcript,
        mode,
        promptOverride
      );
      const entry: TransformEntry = {
        id: generateId("tr"),
        label,
        prompt: promptOverride || mode,
        output,
        createdAt: Date.now(),
      };
      const existing = recording.transforms || [];
      await onUpdate({
        ...recording,
        transforms: [entry, ...existing],
      });
      if (mode === "custom") setCustomPrompt("");
    } catch (err) {
      setTransformError(err instanceof Error ? err.message : "Transform failed.");
    } finally {
      setTransformLoading(null);
    }
  };

  const handleAskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || askLoading) return;
    if (!recording.transcript.trim()) {
      setAskError("Transcribe the recording first so AI can answer questions about it.");
      return;
    }

    setAskError(null);
    setAskLoading(true);
    setQuestion("");

    const userMsg: ChatMessage = {
      id: generateId("msg"),
      role: "user",
      text: q,
      createdAt: Date.now(),
    };

    const prevHistory = recording.chatHistory || [];

    try {
      const answer = await askRecordings({
        contexts: [
          {
            id: recording.id,
            title: recording.title,
            date: new Date(recording.createdAt).toLocaleDateString(),
            transcript: recording.transcript,
          },
        ],
        history: prevHistory.map((m) => ({ role: m.role, text: m.text })),
        question: q,
      });

      const assistantMsg: ChatMessage = {
        id: generateId("msg"),
        role: "assistant",
        text: answer,
        createdAt: Date.now(),
      };

      await onUpdate({
        ...recording,
        chatHistory: [...prevHistory, userMsg, assistantMsg],
      });
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Failed to get answer.");
      setQuestion(q);
    } finally {
      setAskLoading(false);
    }
  };

  const handleConvertTextToAIVoice = async (
    keyId: string,
    textToSpeak: string,
    titleSuffix: string
  ) => {
    if (!textToSpeak.trim()) return;
    setTtsError(null);
    setTtsLoadingId(keyId);
    try {
      const { audioBase64, mimeType } = await generateSingleVoice({
        text: textToSpeak.trim(),
        voiceName: ttsVoice,
      });
      const blob = base64ToBlob(audioBase64, mimeType || "audio/wav");
      await onSaveAIVoiceFromText({
        blob,
        title: `${recording.title} — ${titleSuffix} (${ttsVoice})`,
        folder: recording.folder,
        transcript: textToSpeak.trim(),
        voiceMeta: { mode: "single", voiceA: ttsVoice },
      });
    } catch (err) {
      setTtsError(
        err instanceof Error ? err.message : "Failed to synthesize AI voice."
      );
    } finally {
      setTtsLoadingId(null);
    }
  };

  const kindLabel =
    recording.kind === "ai-voice"
      ? `AI Voice${recording.voiceMeta ? ` (${recording.voiceMeta.voiceA})` : ""}`
      : recording.kind === "uploaded"
      ? "Imported Audio"
      : "Mic Recording";

  return (
    <div className="max-w-4xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-[240px]">
            {editingTitle ? (
              <input
                type="text"
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTitle();
                  if (e.key === "Escape") {
                    setTitleDraft(recording.title);
                    setEditingTitle(false);
                  }
                }}
                className="w-full text-2xl font-semibold tracking-tight px-2 py-1 -ml-2 rounded-lg border border-rose-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                title="Click to rename recording"
                className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 cursor-pointer hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
              >
                {recording.title}
              </h1>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{kindLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatDuration(recording.durationSec)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatBytes(recording.sizeBytes)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatRelativeDate(recording.createdAt)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Recording Folder"
              value={recording.folder}
              onChange={(e) =>
                void onUpdate({ ...recording, folder: e.target.value })
              }
              className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                void onUpdate({ ...recording, starred: !recording.starred })
              }
              aria-label={recording.starred ? "Remove star" : "Star recording"}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors cursor-pointer ${
                recording.starred
                  ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Star className={`w-4 h-4 ${recording.starred ? "fill-current" : ""}`} />
            </button>

            <button
              type="button"
              onClick={handleDownloadAudio}
              disabled={!audioBlob}
              title="Download audio file"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Audio
            </button>

            <button
              type="button"
              onClick={handleExportMarkdown}
              title="Export notes & transcript as Markdown"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              Export .md
            </button>

            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void onDelete(recording.id)}
                  className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete recording"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <WaveformPlayer
          audioBlob={audioBlob}
          peaks={recording.waveformPeaks}
          durationSec={recording.durationSec}
          title={recording.title}
        />
      </div>

      {ttsError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-sm text-red-800 dark:text-red-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{ttsError}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: "transcript", label: "Transcript", icon: FileText },
              { id: "notes", label: "AI Notes", icon: Sparkles },
              { id: "transform", label: "Repurpose", icon: Wand2 },
              { id: "ask", label: "Ask Recording", icon: MessageSquare },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? "border-rose-600 text-slate-900 dark:text-slate-100"
                    : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="hidden sm:flex items-center gap-2 pb-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Voice:
          </span>
          <select
            aria-label="AI Voice Readback Persona"
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value as VoiceName)}
            className="h-8 px-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300"
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeTab === "transcript" && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Full Transcript
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {recording.transcript && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleCopy(recording.transcript)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void handleConvertTextToAIVoice(
                        "transcript_tts",
                        recording.transcript,
                        "AI Readback"
                      )
                    }
                    disabled={ttsLoadingId === "transcript_tts"}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {ttsLoadingId === "transcript_tts" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                    Save as AI Voice
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (editingTranscript) {
                        void saveTranscript();
                      } else {
                        setEditingTranscript(true);
                      }
                    }}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {editingTranscript ? "Save Edits" : "Edit Text"}
                  </button>
                </>
              )}

              {recording.kind !== "ai-voice" && (
                <button
                  type="button"
                  onClick={() => void onRetranscribe(recording)}
                  disabled={recording.transcriptionStatus === "processing"}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                >
                  {recording.transcriptionStatus === "processing" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Transcribing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      {recording.transcript ? "Re-transcribe" : "Transcribe with AI"}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {recording.transcriptionStatus === "processing" && (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-600 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
              <span>Transcribing audio with Gemini 3.5 Transcribe...</span>
            </div>
          )}

          {recording.transcriptionStatus === "error" && recording.transcriptionError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-800 dark:text-red-200"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{recording.transcriptionError}</span>
            </div>
          )}

          {editingTranscript ? (
            <textarea
              rows={12}
              value={transcriptDraft}
              onChange={(e) => setTranscriptDraft(e.target.value)}
              className="w-full p-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm leading-relaxed text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            />
          ) : recording.transcript ? (
            <div className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {recording.transcript}
            </div>
          ) : recording.transcriptionStatus !== "processing" ? (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No transcript generated yet. Click &ldquo;Transcribe with AI&rdquo; to transcribe this recording.
            </div>
          ) : null}
        </div>
      )}

      {activeTab === "notes" && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Structured AI Summary &amp; Action Items
              </h2>
              {recording.analysis?.topics && recording.analysis.topics.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>Topics:</span>
                  {recording.analysis.topics.map((t, idx) => (
                    <React.Fragment key={t}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <span className="text-slate-700 dark:text-slate-300">{t}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {recording.analysis?.tldr && (
                <button
                  type="button"
                  onClick={() =>
                    void handleConvertTextToAIVoice(
                      "summary_tts",
                      `${recording.analysis!.tldr}\n\nKey Takeaways:\n${recording.analysis!.keyPoints.join(". ")}`,
                      "Summary Audio"
                    )
                  }
                  disabled={ttsLoadingId === "summary_tts"}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {ttsLoadingId === "summary_tts" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  Summary to AI Voice
                </button>
              )}

              <button
                type="button"
                onClick={() => void onRegenerateAnalysis(recording)}
                disabled={
                  !recording.transcript.trim() ||
                  recording.transcriptionStatus === "processing"
                }
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-40 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {recording.analysis ? "Regenerate Notes" : "Generate AI Notes"}
              </button>
            </div>
          </div>

          {recording.analysis ? (
            <div className="flex flex-col gap-6">
              <div>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                  TL;DR
                </h3>
                <p className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">
                  {recording.analysis.tldr}
                </p>
              </div>

              {recording.analysis.keyPoints.length > 0 && (
                <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">
                    Key Takeaways
                  </h3>
                  <ul className="flex flex-col gap-2.5 text-sm text-slate-800 dark:text-slate-200">
                    {recording.analysis.keyPoints.map((pt, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="font-mono text-xs text-slate-400 mt-0.5 tabular-nums">
                          {String(idx + 1).padStart(2, "0")}.
                        </span>
                        <span className="leading-relaxed">{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">
                  Action Items
                </h3>
                {recording.analysis.actionItems.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No specific action items detected in this recording.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {recording.analysis.actionItems.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => void toggleActionItem(item.id)}
                          className="w-full flex items-start gap-2.5 text-left py-1.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                        >
                          {item.done ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                          )}
                          <span
                            className={`text-sm leading-relaxed ${
                              item.done
                                ? "line-through text-slate-400 dark:text-slate-500"
                                : "text-slate-800 dark:text-slate-200"
                            }`}
                          >
                            {item.text}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {recording.transcript.trim()
                ? "Click \"Generate AI Notes\" to extract a TL;DR summary, key takeaways, and action items."
                : "Transcribe this recording first to unlock AI Notes."}
            </div>
          )}
        </div>
      )}

      {activeTab === "transform" && (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Repurpose Recording
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Transform this voice transcript into polished formats or generate an AI voice recording from the result.
              </p>
            </div>

            {transformError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{transformError}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {TRANSFORM_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={transformLoading !== null || !recording.transcript.trim()}
                  onClick={() => void handleRunTransform(m.id, m.label)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {transformLoading === m.id && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customPrompt.trim()) {
                    void handleRunTransform("custom", "Custom Transform", customPrompt);
                  }
                }}
                placeholder="Custom instruction (e.g., Turn into 5 concise study flashcards)"
                className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
              <button
                type="button"
                disabled={
                  !customPrompt.trim() ||
                  transformLoading !== null ||
                  !recording.transcript.trim()
                }
                onClick={() =>
                  void handleRunTransform("custom", "Custom Transform", customPrompt)
                }
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-40 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                {transformLoading === "custom" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                Run
              </button>
            </div>
          </div>

          {(recording.transforms || []).map((tr) => (
            <div
              key={tr.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {tr.label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeDate(tr.createdAt)}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy(tr.output)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                  <button
                    type="button"
                    disabled={ttsLoadingId === tr.id}
                    onClick={() =>
                      void handleConvertTextToAIVoice(tr.id, tr.output, tr.label)
                    }
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {ttsLoadingId === tr.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                    Save as AI Voice
                  </button>
                </div>
              </div>
              <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                {tr.output}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "ask" && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Ask About This Recording
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Query any detail, quote, or decision from this recording&rsquo;s transcript.
            </p>
          </div>

          {askError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{askError}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 max-h-[380px] overflow-y-auto pr-1">
            {(recording.chatHistory || []).length === 0 ? (
              <div className="py-6 text-sm text-slate-500 dark:text-slate-400">
                Ask a question below — for example, &ldquo;What were the main concerns mentioned?&rdquo; or &ldquo;List every deadline.&rdquo;
              </div>
            ) : (
              (recording.chatHistory || []).map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-slate-900 dark:bg-slate-800 text-white self-end max-w-[85%]"
                      : "bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 self-start max-w-[92%]"
                  }`}
                >
                  {msg.text}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleAskSubmit} className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={!recording.transcript.trim() || askLoading}
              placeholder={
                recording.transcript.trim()
                  ? "Ask a question about this recording..."
                  : "Transcribe this recording first..."
              }
              className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!question.trim() || !recording.transcript.trim() || askLoading}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              {askLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Ask
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
