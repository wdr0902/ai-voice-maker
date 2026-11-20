export type RecordingKind = "recording" | "ai-voice" | "uploaded";

export type TranscriptionStatus = "idle" | "processing" | "done" | "error";

export type VoiceName = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
}

export interface RecordingAnalysis {
  tldr: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  topics: string[];
  updatedAt: number;
}

export interface TransformEntry {
  id: string;
  label: string;
  prompt: string;
  output: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

export interface VoiceMeta {
  mode: "single" | "dialogue";
  voiceA: VoiceName;
  voiceB?: VoiceName;
  styleA?: string;
  styleB?: string;
}

export interface RecordingMeta {
  id: string;
  title: string;
  kind: RecordingKind;
  createdAt: number;
  durationSec: number;
  mimeType: string;
  sizeBytes: number;
  folder: string;
  starred: boolean;
  waveformPeaks: number[];
  transcript: string;
  transcriptionStatus: TranscriptionStatus;
  transcriptionError?: string;
  analysis?: RecordingAnalysis;
  voiceMeta?: VoiceMeta;
  transforms?: TransformEntry[];
  chatHistory?: ChatMessage[];
}

export type AppView = "record" | "detail" | "voice-studio" | "library" | "ask-vault";

export type SidebarFilter = "all" | "recording" | "ai-voice" | "starred";

export interface StorageStats {
  recordingCount: number;
  totalAudioBytes: number;
  browserUsedBytes?: number;
  browserQuotaBytes?: number;
}
