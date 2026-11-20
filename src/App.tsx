import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderPlus,
  Loader2,
  Menu,
  Mic,
  Moon,
  Plus,
  Search,
  Sparkles,
  Star,
  Sun,
  X,
} from "lucide-react";
import { AskVaultView } from "./components/AskVaultView";
import { LibraryView } from "./components/LibraryView";
import { RecorderStudio } from "./components/RecorderStudio";
import { RecordingDetail } from "./components/RecordingDetail";
import { VoiceStudio } from "./components/VoiceStudio";
import { analyzeTranscript, transcribeAudioBlob } from "./lib/api";
import {
  analyzeAudioBlob,
  formatBytes,
  formatDuration,
  formatRelativeDate,
  generateId,
} from "./lib/audioUtils";
import {
  deleteRecording,
  deleteRecordingsBulk,
  getRecordingBlob,
  getStorageStats,
  listRecordings,
  loadFolders,
  saveFolders,
  saveRecordingWithBlob,
  updateRecordingMeta,
} from "./lib/db";
import type {
  AppView,
  RecordingMeta,
  SidebarFilter,
  StorageStats,
  VoiceMeta,
} from "./types";

const THEME_KEY = "echovault_theme";
const AUTO_AI_KEY = "echovault_auto_ai";

export default function App() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark";
    } catch {
      return false;
    }
  });

  const [autoAI, setAutoAI] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_AI_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  const [view, setView] = useState<AppView>("record");
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [loadingVault, setLoadingVault] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBlob, setSelectedBlob] = useState<Blob | null>(null);

  const [folders, setFolders] = useState<string[]>(() => loadFolders());
  const [sidebarFolder, setSidebarFolder] = useState<string>("ALL");
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>("all");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [storageStats, setStorageStats] = useState<StorageStats>({
    recordingCount: 0,
    totalAudioBytes: 0,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      // Ignore
    }
  }, [dark]);

  const handleToggleAutoAI = (val: boolean) => {
    setAutoAI(val);
    try {
      localStorage.setItem(AUTO_AI_KEY, String(val));
    } catch {
      // Ignore
    }
  };

  const refreshStorageStats = useCallback(async (list: RecordingMeta[]) => {
    const stats = await getStorageStats(list);
    setStorageStats(stats);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listRecordings();
        if (!active) return;
        setRecordings(list);
        await refreshStorageStats(list);
      } finally {
        if (active) setLoadingVault(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshStorageStats]);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setSelectedBlob(null);
      return;
    }
    (async () => {
      const blob = await getRecordingBlob(selectedId);
      if (active) setSelectedBlob(blob);
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectedRecording = useMemo(
    () => recordings.find((r) => r.id === selectedId) || null,
    [recordings, selectedId]
  );

  const filteredSidebarRecordings = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    return recordings.filter((r) => {
      if (sidebarFolder !== "ALL" && r.folder !== sidebarFolder) return false;
      if (sidebarFilter === "recording" && r.kind === "ai-voice") return false;
      if (sidebarFilter === "ai-voice" && r.kind !== "ai-voice") return false;
      if (sidebarFilter === "starred" && !r.starred) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.transcript.toLowerCase().includes(q)
      );
    });
  }, [recordings, sidebarFolder, sidebarFilter, sidebarSearch]);

  const patchRecordingInState = useCallback(
    async (updated: RecordingMeta) => {
      await updateRecordingMeta(updated);
      setRecordings((prev) => {
        const next = prev.map((r) => (r.id === updated.id ? updated : r));
        void refreshStorageStats(next);
        return next;
      });
    },
    [refreshStorageStats]
  );

  const runAnalysisForRecording = useCallback(
    async (rec: RecordingMeta, keepExistingTitle = true) => {
      if (!rec.transcript.trim()) return;
      try {
        const result = await analyzeTranscript(rec.transcript, rec.title);
        const shouldUseSuggestedTitle =
          !keepExistingTitle && Boolean(result.suggestedTitle?.trim());

        const nextRec: RecordingMeta = {
          ...rec,
          title: shouldUseSuggestedTitle ? result.suggestedTitle.trim() : rec.title,
          analysis: {
            tldr: result.tldr || "",
            keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : [],
            actionItems: (Array.isArray(result.actionItems)
              ? result.actionItems
              : []
            ).map((text) => ({
              id: generateId("act"),
              text,
              done: false,
            })),
            topics: Array.isArray(result.topics) ? result.topics : [],
            updatedAt: Date.now(),
          },
        };
        await patchRecordingInState(nextRec);
      } catch {
        // Keep transcript intact even if optional analysis call fails
      }
    },
    [patchRecordingInState]
  );

  const runTranscriptionPipeline = useCallback(
    async (rec: RecordingMeta, blob: Blob, replaceDefaultTitle: boolean) => {
      const processingRec: RecordingMeta = {
        ...rec,
        transcriptionStatus: "processing",
        transcriptionError: undefined,
      };
      await patchRecordingInState(processingRec);

      try {
        const transcript = await transcribeAudioBlob(blob);
        const transcribedRec: RecordingMeta = {
          ...processingRec,
          transcript,
          transcriptionStatus: "done",
          transcriptionError: undefined,
        };
        await patchRecordingInState(transcribedRec);

        if (transcript.trim()) {
          await runAnalysisForRecording(transcribedRec, !replaceDefaultTitle);
        }
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Transcription failed.";
        await patchRecordingInState({
          ...processingRec,
          transcriptionStatus: "error",
          transcriptionError: errorMsg,
        });
      }
    },
    [patchRecordingInState, runAnalysisForRecording]
  );

  const handleSaveRecording = async (params: {
    blob: Blob;
    title: string;
    folder: string;
    kind: "recording" | "uploaded";
    draftTranscript?: string;
    durationHintMs?: number;
  }) => {
    const { durationSec, peaks } = await analyzeAudioBlob(params.blob, 88);
    const finalDuration =
      durationSec > 0
        ? durationSec
        : params.durationHintMs
        ? params.durationHintMs / 1000
        : 0;

    const isDefaultTitle = params.title.startsWith("Voice Note — ");
    const meta: RecordingMeta = {
      id: generateId("rec"),
      title: params.title,
      kind: params.kind,
      createdAt: Date.now(),
      durationSec: finalDuration,
      mimeType: params.blob.type || "audio/webm",
      sizeBytes: params.blob.size,
      folder: params.folder,
      starred: false,
      waveformPeaks: peaks,
      transcript: params.draftTranscript || "",
      transcriptionStatus: autoAI ? "processing" : "idle",
    };

    await saveRecordingWithBlob(meta, params.blob);
    setRecordings((prev) => {
      const next = [meta, ...prev];
      void refreshStorageStats(next);
      return next;
    });
    setSelectedId(meta.id);
    setSelectedBlob(params.blob);
    setView("detail");

    if (autoAI) {
      void runTranscriptionPipeline(meta, params.blob, isDefaultTitle);
    }
  };

  const handleSaveAIVoice = async (params: {
    blob: Blob;
    title: string;
    folder: string;
    transcript: string;
    voiceMeta: VoiceMeta;
  }) => {
    const { durationSec, peaks } = await analyzeAudioBlob(params.blob, 88);
    const meta: RecordingMeta = {
      id: generateId("ai"),
      title: params.title,
      kind: "ai-voice",
      createdAt: Date.now(),
      durationSec,
      mimeType: params.blob.type || "audio/wav",
      sizeBytes: params.blob.size,
      folder: params.folder,
      starred: false,
      waveformPeaks: peaks,
      transcript: params.transcript,
      transcriptionStatus: "done",
      voiceMeta: params.voiceMeta,
    };

    await saveRecordingWithBlob(meta, params.blob);
    setRecordings((prev) => {
      const next = [meta, ...prev];
      void refreshStorageStats(next);
      return next;
    });
    setSelectedId(meta.id);
    setSelectedBlob(params.blob);
    setView("detail");
  };

  const handleDeleteRecording = async (id: string) => {
    await deleteRecording(id);
    setRecordings((prev) => {
      const next = prev.filter((r) => r.id !== id);
      void refreshStorageStats(next);
      return next;
    });
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedBlob(null);
      setView("record");
    }
  };

  const handleBulkDelete = async (ids: string[]) => {
    await deleteRecordingsBulk(ids);
    const idSet = new Set(ids);
    setRecordings((prev) => {
      const next = prev.filter((r) => !idSet.has(r.id));
      void refreshStorageStats(next);
      return next;
    });
    if (selectedId && idSet.has(selectedId)) {
      setSelectedId(null);
      setSelectedBlob(null);
    }
  };

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const updated = saveFolders([...folders, trimmed]);
    setFolders(updated);
    setSidebarFolder(trimmed);
    setNewFolderName("");
    setAddingFolder(false);
  };

  const openRecording = (id: string) => {
    setSelectedId(id);
    setView("detail");
    setMobileDrawerOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Search recordings..."
            className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
          />
        </div>

        <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">
          {(
            [
              { id: "all", label: "All" },
              { id: "recording", label: "Mic" },
              { id: "ai-voice", label: "AI" },
              { id: "starred", label: "Star" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSidebarFilter(tab.id)}
              className={`h-7 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                sidebarFilter === tab.id
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <select
            aria-label="Filter sidebar by folder"
            value={sidebarFolder}
            onChange={(e) => setSidebarFolder(e.target.value)}
            className="flex-1 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 truncate"
          >
            <option value="ALL">All Folders</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setAddingFolder((v) => !v)}
            title="New folder"
            aria-label="Create new folder"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>

        {addingFolder && (
          <form onSubmit={handleCreateFolder} className="flex gap-1.5">
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              className="flex-1 h-8 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="h-8 px-2.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium cursor-pointer"
            >
              Add
            </button>
          </form>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        {loadingVault ? (
          <div className="p-4 flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading vault...
          </div>
        ) : filteredSidebarRecordings.length === 0 ? (
          <div className="p-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {recordings.length === 0
              ? "No recordings yet. Record your voice or generate an AI voice track to fill your unlimited vault."
              : "No recordings match this filter."}
          </div>
        ) : (
          filteredSidebarRecordings.map((rec) => {
            const active = selectedId === rec.id && view === "detail";
            return (
              <button
                key={rec.id}
                type="button"
                onClick={() => openRecording(rec.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer flex flex-col gap-1 ${
                  active
                    ? "bg-slate-100 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100"
                    : "hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">
                    {rec.title}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {rec.transcriptionStatus === "processing" && (
                      <Loader2 className="w-3 h-3 animate-spin text-rose-600" />
                    )}
                    {rec.starred && (
                      <Star className="w-3 h-3 text-amber-500 fill-current" />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  <span className="font-mono tabular-nums">
                    {formatDuration(rec.durationSec)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {rec.kind === "ai-voice" ? "AI Voice" : rec.kind === "uploaded" ? "File" : "Mic"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{formatRelativeDate(rec.createdAt)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="font-mono tabular-nums truncate">
          {storageStats.recordingCount} saved · {formatBytes(storageStats.totalAudioBytes)}
        </div>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
        >
          {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen((o) => !o)}
            aria-label="Toggle recordings sidebar"
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            {mobileDrawerOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setView("record")}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            EchoVault
          </button>
        </div>

        <nav
          aria-label="Primary workspace navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {(
            [
              { id: "record", label: "Record" },
              { id: "voice-studio", label: "Voice Studio" },
              { id: "library", label: "Library" },
              { id: "ask-vault", label: "Ask Vault" },
            ] as const
          ).map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? "border-rose-600 text-slate-900 dark:text-slate-100"
                    : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setView("record")}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Recording
          </button>
        </div>
      </header>

      <div className="flex md:hidden items-center justify-around border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-medium">
        {(
          [
            { id: "record", label: "Record", icon: Mic },
            { id: "voice-studio", label: "AI Voice", icon: Sparkles },
            { id: "library", label: "Library", icon: Menu },
            { id: "ask-vault", label: "Ask", icon: Search },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              view === item.id
                ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0 relative">
        <aside className="hidden lg:flex w-[272px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col">
          {renderSidebarContent()}
        </aside>

        {mobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div
              className="fixed inset-0 bg-black/40"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <aside className="relative w-[280px] max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-10 flex flex-col">
              {renderSidebarContent()}
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 overflow-y-auto">
          {view === "record" && (
            <RecorderStudio
              folders={folders}
              defaultFolder={sidebarFolder === "ALL" ? "General" : sidebarFolder}
              autoAI={autoAI}
              onToggleAutoAI={handleToggleAutoAI}
              onSaveRecording={handleSaveRecording}
            />
          )}

          {view === "voice-studio" && (
            <VoiceStudio
              folders={folders}
              onSaveAIVoice={handleSaveAIVoice}
            />
          )}

          {view === "library" && (
            <LibraryView
              recordings={recordings}
              folders={folders}
              storageStats={storageStats}
              onSelectRecording={openRecording}
              onBulkDelete={handleBulkDelete}
              onStartNewRecording={() => setView("record")}
            />
          )}

          {view === "ask-vault" && (
            <AskVaultView
              recordings={recordings}
              onOpenRecording={openRecording}
            />
          )}

          {view === "detail" && selectedRecording && (
            <RecordingDetail
              recording={selectedRecording}
              audioBlob={selectedBlob}
              folders={folders}
              onUpdate={patchRecordingInState}
              onDelete={handleDeleteRecording}
              onRetranscribe={async (rec) => {
                const blob =
                  selectedBlob || (await getRecordingBlob(rec.id));
                if (blob) {
                  await runTranscriptionPipeline(rec, blob, false);
                }
              }}
              onRegenerateAnalysis={async (rec) => {
                await runAnalysisForRecording(rec, true);
              }}
              onSaveAIVoiceFromText={handleSaveAIVoice}
            />
          )}

          {view === "detail" && !selectedRecording && (
            <RecorderStudio
              folders={folders}
              defaultFolder={sidebarFolder === "ALL" ? "General" : sidebarFolder}
              autoAI={autoAI}
              onToggleAutoAI={handleToggleAutoAI}
              onSaveRecording={handleSaveRecording}
            />
          )}
        </main>
      </div>
    </div>
  );
}
