import React, { useMemo, useState } from "react";
import {
  CheckSquare,
  Download,
  Mic,
  Search,
  Sparkles,
  Square,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import {
  downloadText,
  formatBytes,
  formatDuration,
  formatRelativeDate,
} from "../lib/audioUtils";
import type { RecordingMeta, StorageStats } from "../types";

interface LibraryViewProps {
  recordings: RecordingMeta[];
  folders: string[];
  storageStats: StorageStats;
  onSelectRecording: (id: string) => void;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onStartNewRecording: () => void;
}

type SortKey = "newest" | "oldest" | "longest" | "title";

export const LibraryView: React.FC<LibraryViewProps> = ({
  recordings,
  folders,
  storageStats,
  onSelectRecording,
  onBulkDelete,
  onStartNewRecording,
}) => {
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("ALL");
  const [kindFilter, setKindFilter] = useState<"all" | "recording" | "ai-voice" | "uploaded">("all");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = recordings.filter((r) => {
      if (folderFilter !== "ALL" && r.folder !== folderFilter) return false;
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.transcript.toLowerCase().includes(q) ||
        (r.analysis?.tldr || "").toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      if (sortBy === "oldest") return a.createdAt - b.createdAt;
      if (sortBy === "longest") return b.durationSec - a.durationSec;
      if (sortBy === "title") return a.title.localeCompare(b.title);
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [recordings, query, folderFilter, kindFilter, sortBy]);

  const totalDuration = useMemo(
    () => recordings.reduce((sum, r) => sum + (r.durationSec || 0), 0),
    [recordings]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmBulkDelete(false);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
    setConfirmBulkDelete(false);
  };

  const handleExportSelectedMarkdown = () => {
    const targets =
      selectedIds.size > 0
        ? filtered.filter((r) => selectedIds.has(r.id))
        : filtered;
    if (targets.length === 0) return;

    const md = targets
      .map((r) => {
        const parts = [
          `# ${r.title}`,
          `Date: ${new Date(r.createdAt).toLocaleString()} · Duration: ${formatDuration(
            r.durationSec
          )} · Folder: ${r.folder}`,
          "",
        ];
        if (r.analysis?.tldr) {
          parts.push(`**Summary:** ${r.analysis.tldr}`, "");
        }
        parts.push(r.transcript || "_No transcript_", "", "---", "");
        return parts.join("\n");
      })
      .join("\n");

    downloadText(md, `echovault-export-${new Date().toISOString().slice(0, 10)}.md`);
  };

  const handleConfirmDelete = async () => {
    const ids = Array.from(selectedIds);
    await onBulkDelete(ids);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Recordings Vault
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono tabular-nums">
              {storageStats.recordingCount} recordings
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {formatDuration(totalDuration)} total audio
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {formatBytes(storageStats.totalAudioBytes)} stored locally
            </span>
            {storageStats.browserQuotaBytes && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatBytes(storageStats.browserQuotaBytes)} browser capacity
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportSelectedMarkdown}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          {selectedIds.size > 0
            ? `Export ${selectedIds.size} Selected (.md)`
            : "Export All (.md)"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, transcripts, summaries..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>

        <select
          aria-label="Filter by type"
          value={kindFilter}
          onChange={(e) =>
            setKindFilter(e.target.value as "all" | "recording" | "ai-voice" | "uploaded")
          }
          className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300"
        >
          <option value="all">All Sources</option>
          <option value="recording">Mic Recordings</option>
          <option value="ai-voice">AI Voices</option>
          <option value="uploaded">Imported Files</option>
        </select>

        <select
          aria-label="Filter by folder"
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300"
        >
          <option value="ALL">All Folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort recordings"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="longest">Longest Duration</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-xs">
          <span className="font-medium text-slate-800 dark:text-slate-200 font-mono tabular-nums">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            {confirmBulkDelete ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  className="h-8 px-3 rounded-md bg-red-600 text-white font-medium cursor-pointer"
                >
                  Confirm Delete ({selectedIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(false)}
                  className="h-8 px-2.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 font-medium cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center flex flex-col items-center gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {recordings.length === 0
              ? "Your recordings vault is empty. Start your first unlimited recording or generate an AI voice clip."
              : "No recordings match your current search or filters."}
          </p>
          {recordings.length === 0 && (
            <button
              type="button"
              onClick={onStartNewRecording}
              className="mt-1 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              Start First Recording
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="w-10 px-4 py-3">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      aria-label="Select all recordings"
                      className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {selectedIds.size === filtered.length && filtered.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-rose-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Folder</th>
                  <th className="px-3 py-3 text-right">Duration</th>
                  <th className="px-3 py-3 text-right">Size</th>
                  <th className="px-4 py-3 text-right">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80 text-sm">
                {filtered.map((rec) => {
                  const checked = selectedIds.has(rec.id);
                  return (
                    <tr
                      key={rec.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleSelect(rec.id)}
                          aria-label={`Select ${rec.title}`}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-rose-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3 max-w-[300px]">
                        <button
                          type="button"
                          onClick={() => onSelectRecording(rec.id)}
                          className="flex items-center gap-2 text-left font-medium text-slate-900 dark:text-slate-100 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer truncate w-full"
                        >
                          {rec.starred && (
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-current shrink-0" />
                          )}
                          <span className="truncate">{rec.title}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {rec.kind === "ai-voice" ? (
                            <Sparkles className="w-3.5 h-3.5" />
                          ) : rec.kind === "uploaded" ? (
                            <Upload className="w-3.5 h-3.5" />
                          ) : (
                            <Mic className="w-3.5 h-3.5" />
                          )}
                          {rec.kind === "ai-voice"
                            ? "AI Voice"
                            : rec.kind === "uploaded"
                            ? "Imported"
                            : "Mic"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {rec.folder}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatDuration(rec.durationSec)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatBytes(rec.sizeBytes)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatRelativeDate(rec.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
