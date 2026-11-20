import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckSquare,
  Loader2,
  MessageSquare,
  Send,
  Square,
} from "lucide-react";
import { askRecordings } from "../lib/api";
import { formatDuration, generateId } from "../lib/audioUtils";
import type { ChatMessage, RecordingMeta } from "../types";

interface AskVaultViewProps {
  recordings: RecordingMeta[];
  onOpenRecording: (id: string) => void;
}

export const AskVaultView: React.FC<AskVaultViewProps> = ({
  recordings,
  onOpenRecording,
}) => {
  const transcribed = useMemo(
    () => recordings.filter((r) => r.transcript.trim().length > 0),
    [recordings]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(transcribed.slice(0, 12).map((r) => r.id))
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveSelected = useMemo(() => {
    const valid = new Set(
      Array.from(selectedIds).filter((id) => transcribed.some((r) => r.id === id))
    );
    if (valid.size === 0 && transcribed.length > 0 && selectedIds.size === 0) {
      return new Set(transcribed.slice(0, 12).map((r) => r.id));
    }
    return valid;
  }, [selectedIds, transcribed]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev.size === 0 ? effectiveSelected : prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(transcribed.map((r) => r.id)));
  };

  const clearAll = () => {
    setSelectedIds(new Set(["__none__"]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    const chosen = transcribed.filter((r) => effectiveSelected.has(r.id));
    if (chosen.length === 0) {
      setErrorMsg("Select at least one transcribed recording to query.");
      return;
    }

    setErrorMsg(null);
    setInput("");
    setLoading(true);

    const userMsg: ChatMessage = {
      id: generateId("vq"),
      role: "user",
      text: q,
      createdAt: Date.now(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);

    try {
      const answer = await askRecordings({
        contexts: chosen.map((r) => ({
          id: r.id,
          title: r.title,
          date: new Date(r.createdAt).toLocaleDateString(),
          transcript: r.transcript,
        })),
        history: messages.map((m) => ({ role: m.role, text: m.text })),
        question: q,
      });

      const assistantMsg: ChatMessage = {
        id: generateId("va"),
        role: "assistant",
        text: answer,
        createdAt: Date.now(),
      };
      setMessages([...nextHistory, assistantMsg]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to query recordings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Ask Your Vault
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Synthesize insights, combine action items, or search facts across multiple voice recordings at once.
        </p>
      </div>

      {transcribed.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-sm text-slate-500 dark:text-slate-400">
          Record or import audio with transcription enabled to query across your library.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Included Context ({effectiveSelected.size})
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                >
                  All
                </button>
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                >
                  None
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto">
              {transcribed.map((rec) => {
                const active = effectiveSelected.has(rec.id);
                return (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <button
                      type="button"
                      onClick={() => toggleId(rec.id)}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      {active ? (
                        <CheckSquare className="w-4 h-4 text-rose-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                          {rec.title}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {formatDuration(rec.durationSec)} · {rec.folder}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenRecording(rec.id)}
                      className="text-[11px] text-slate-400 hover:text-rose-600 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Open
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-4 min-h-[460px]">
            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex-1 flex flex-col gap-3 overflow-y-auto max-h-[380px] pr-1">
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-12 gap-3">
                  <MessageSquare className="w-7 h-7 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
                    Ask anything across your {effectiveSelected.size} selected recording
                    {effectiveSelected.size === 1 ? "" : "s"}.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-1">
                    {[
                      "Summarize the key themes across these recordings",
                      "List every action item mentioned",
                      "Compare the main ideas across sessions",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setInput(suggestion)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
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

            <form
              onSubmit={handleSubmit}
              className="flex gap-2 pt-3 border-t border-slate-200 dark:border-slate-800"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                placeholder="Ask across your selected recordings..."
                className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading || effectiveSelected.size === 0}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Ask
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
