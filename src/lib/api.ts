import type { VoiceName } from "../types";

async function parseErrorResponse(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    // Fallback to status text
  }
  return `Request failed (${res.status} ${res.statusText})`;
}

export async function transcribeAudioBlob(
  blob: Blob,
  hint?: string
): Promise<string> {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Audio-Mime-Type": blob.type || "audio/webm",
      ...(hint ? { "X-Transcribe-Hint": hint } : {}),
    },
    body: blob,
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  const data = (await res.json()) as { transcript: string };
  return data.transcript;
}

export interface AnalyzeResponse {
  suggestedTitle: string;
  tldr: string;
  keyPoints: string[];
  actionItems: string[];
  topics: string[];
}

export async function analyzeTranscript(
  transcript: string,
  existingTitle?: string
): Promise<AnalyzeResponse> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, existingTitle }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  return (await res.json()) as AnalyzeResponse;
}

export async function transformTranscript(
  transcript: string,
  mode: string,
  customPrompt?: string
): Promise<string> {
  const res = await fetch("/api/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, mode, customPrompt }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  const data = (await res.json()) as { output: string };
  return data.output;
}

export async function askRecordings(params: {
  contexts: Array<{ id: string; title: string; date: string; transcript: string }>;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  question: string;
}): Promise<string> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  const data = (await res.json()) as { answer: string };
  return data.answer;
}

export async function generateSingleVoice(params: {
  text: string;
  voiceName: VoiceName;
  style?: string;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const res = await fetch("/api/tts/single", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  return (await res.json()) as { audioBase64: string; mimeType: string };
}

export async function generateDialogueVoice(params: {
  lines: Array<{ speaker: string; text: string }>;
  speakerA: { name: string; voiceName: VoiceName; style?: string };
  speakerB: { name: string; voiceName: VoiceName; style?: string };
}): Promise<{ audioBase64: string; mimeType: string }> {
  const res = await fetch("/api/tts/dialogue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
  return (await res.json()) as { audioBase64: string; mimeType: string };
}
