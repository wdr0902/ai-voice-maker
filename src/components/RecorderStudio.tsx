import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  Mic,
  Pause,
  Play,
  Square,
  Trash2,
  Upload,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { formatPreciseTimer } from "../lib/audioUtils";

interface RecorderStudioProps {
  folders: string[];
  defaultFolder: string;
  autoAI: boolean;
  onToggleAutoAI: (val: boolean) => void;
  onSaveRecording: (params: {
    blob: Blob;
    title: string;
    folder: string;
    kind: "recording" | "uploaded";
    draftTranscript?: string;
    durationHintMs?: number;
  }) => Promise<void>;
}

type RecStatus = "idle" | "recording" | "paused" | "saving";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const RecorderStudio: React.FC<RecorderStudioProps> = ({
  folders,
  defaultFolder,
  autoAI,
  onToggleAutoAI,
  onSaveRecording,
}) => {
  const [status, setStatus] = useState<RecStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [selectedFolder, setSelectedFolder] = useState(defaultFolder || "General");
  const [customTitle, setCustomTitle] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveDraft, setLiveDraft] = useState("");
  const [interimDraft, setInterimDraft] = useState("");
  const [dbLevel, setDbLevel] = useState(-60);
  const [isDragging, setIsDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const startedAtRef = useRef(0);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const statusRef = useRef<RecStatus>("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const discardFlagRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = list.filter((d) => d.kind === "audioinput");
      setDevices(audioInputs);
      if (!selectedDeviceId && audioInputs.length > 0 && audioInputs[0].deviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch {
      // Ignore enumerate failure before permission
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const drawIdleCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    const isDark = document.documentElement.classList.contains("dark");
    ctx.strokeStyle = isDark ? "rgba(148, 163, 184, 0.2)" : "rgba(100, 116, 139, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    const barCount = Math.max(40, Math.floor(width / 8));
    const gap = width / barCount;
    ctx.fillStyle = isDark ? "rgba(148, 163, 184, 0.28)" : "rgba(100, 116, 139, 0.25)";
    for (let i = 0; i < barCount; i++) {
      const x = i * gap + gap * 0.25;
      const barW = Math.max(2, gap * 0.5);
      const h = 4;
      ctx.fillRect(x, midY - h / 2, barW, h);
    }
  }, []);

  useEffect(() => {
    if (status === "idle") {
      drawIdleCanvas();
    }
  }, [status, drawIdleCanvas]);

  const startVisualizer = useCallback((stream: MediaStream) => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    const render = () => {
      if (statusRef.current === "idle" || statusRef.current === "saving") return;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const width = canvas.clientWidth;
          const height = canvas.clientHeight;
          if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);

          analyser.getByteFrequencyData(freqData);
          analyser.getByteTimeDomainData(timeData);

          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / timeData.length);
          const db = rms > 0.0005 ? Math.max(-60, Math.round(20 * Math.log10(rms))) : -60;
          setDbLevel(statusRef.current === "paused" ? -60 : db);

          const midY = height / 2;
          const barCount = Math.max(40, Math.floor(width / 8));
          const gap = width / barCount;
          const isPaused = statusRef.current === "paused";
          const isDark = document.documentElement.classList.contains("dark");

          for (let i = 0; i < barCount; i++) {
            const freqIndex = Math.min(
              bufferLength - 1,
              Math.floor((i / barCount) * (bufferLength * 0.75))
            );
            const val = isPaused ? 0.04 : freqData[freqIndex] / 255;
            const barH = Math.max(4, val * (height - 16));
            const x = i * gap + gap * 0.25;
            const barW = Math.max(2, gap * 0.5);

            ctx.fillStyle = isPaused
              ? isDark
                ? "rgba(148, 163, 184, 0.35)"
                : "rgba(100, 116, 139, 0.35)"
              : val > 0.55
              ? "#e11d48"
              : isDark
              ? "#f43f5e"
              : "#be123c";

            ctx.beginPath();
            ctx.roundRect(x, midY - barH / 2, barW, barH, barW / 2);
            ctx.fill();
          }
        }
      }
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
  }, []);

  const stopSpeechPreview = useCallback(() => {
    if (speechRef.current) {
      try {
        speechRef.current.onend = null;
        speechRef.current.stop();
      } catch {
        // Ignore
      }
      speechRef.current = null;
    }
  }, []);

  const startSpeechPreview = useCallback(() => {
    const Win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const sr = new SR();
      sr.continuous = true;
      sr.interimResults = true;
      sr.lang = navigator.language || "en-US";
      sr.onresult = (event) => {
        let finalSeg = "";
        let interimSeg = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) {
            finalSeg += text + " ";
          } else {
            interimSeg += text;
          }
        }
        if (finalSeg) {
          setLiveDraft((prev) => (prev ? `${prev.trim()} ${finalSeg.trim()}` : finalSeg.trim()));
        }
        setInterimDraft(interimSeg);
      };
      sr.onerror = () => {
        // Live preview is optional; ignore browser speech errors
      };
      sr.onend = () => {
        if (statusRef.current === "recording") {
          try {
            sr.start();
          } catch {
            // Ignore restart errors
          }
        }
      };
      sr.start();
      speechRef.current = sr;
    } catch {
      // SpeechRecognition optional
    }
  }, []);

  const cleanupMedia = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopSpeechPreview();
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [stopSpeechPreview]);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const pickSupportedMimeType = (): string => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const mime of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return "";
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setLiveDraft("");
    setInterimDraft("");
    discardFlagRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(
        "Microphone recording is not supported in this browser context. You can still upload an audio file below."
      );
      return;
    }

    try {
      const audioConstraint: MediaTrackConstraints = {
        echoCancellation: noiseSuppression,
        noiseSuppression,
        autoGainControl: true,
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      streamRef.current = stream;
      void refreshDevices();

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const totalMs = accumulatedMsRef.current;
        const draft = [liveDraftRef.current, interimDraftRef.current]
          .filter(Boolean)
          .join(" ")
          .trim();
        cleanupMedia();

        if (discardFlagRef.current) {
          chunksRef.current = [];
          setStatus("idle");
          setElapsedMs(0);
          setLiveDraft("");
          setInterimDraft("");
          return;
        }

        const recordedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: recordedType });
        chunksRef.current = [];

        if (blob.size === 0) {
          setErrorMsg("Recording was empty. Please check your microphone input.");
          setStatus("idle");
          setElapsedMs(0);
          return;
        }

        setStatus("saving");
        try {
          const fallbackTitle =
            customTitle.trim() ||
            `Voice Note — ${new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`;

          await onSaveRecording({
            blob,
            title: fallbackTitle,
            folder: selectedFolder,
            kind: "recording",
            draftTranscript: draft || undefined,
            durationHintMs: totalMs,
          });
          setCustomTitle("");
          setLiveDraft("");
          setInterimDraft("");
        } catch (err) {
          setErrorMsg(
            err instanceof Error ? err.message : "Failed to save recording."
          );
        } finally {
          setStatus("idle");
          setElapsedMs(0);
        }
      };

      mediaRecorderRef.current = recorder;
      accumulatedMsRef.current = 0;
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setStatus("recording");
      statusRef.current = "recording";

      recorder.start(1000);
      startVisualizer(stream);
      startSpeechPreview();

      timerRef.current = window.setInterval(() => {
        if (statusRef.current === "recording") {
          const now = performance.now();
          setElapsedMs(accumulatedMsRef.current + (now - startedAtRef.current));
        }
      }, 100);
    } catch (err) {
      cleanupMedia();
      setStatus("idle");
      const msg =
        err instanceof Error ? err.message : "Unable to access microphone.";
      setErrorMsg(
        msg.includes("Permission") || msg.includes("NotAllowed")
          ? "Microphone permission was denied. Allow microphone access in your browser settings or upload an audio file."
          : msg
      );
    }
  };

  const liveDraftRef = useRef("");
  const interimDraftRef = useRef("");
  useEffect(() => {
    liveDraftRef.current = liveDraft;
  }, [liveDraft]);
  useEffect(() => {
    interimDraftRef.current = interimDraft;
  }, [interimDraft]);

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || status !== "recording") return;
    if (recorder.state === "recording") {
      recorder.pause();
      accumulatedMsRef.current += performance.now() - startedAtRef.current;
      setElapsedMs(accumulatedMsRef.current);
      setStatus("paused");
      statusRef.current = "paused";
      stopSpeechPreview();
    }
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || status !== "paused") return;
    if (recorder.state === "paused") {
      recorder.resume();
      startedAtRef.current = performance.now();
      setStatus("recording");
      statusRef.current = "recording";
      startSpeechPreview();
    }
  };

  const stopAndSave = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || (status !== "recording" && status !== "paused")) return;
    if (status === "recording") {
      accumulatedMsRef.current += performance.now() - startedAtRef.current;
    }
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const discardRecording = () => {
    const recorder = mediaRecorderRef.current;
    discardFlagRef.current = true;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      cleanupMedia();
      setStatus("idle");
      setElapsedMs(0);
    }
  };

  const handleFileImport = async (file: File) => {
    setErrorMsg(null);
    if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|wav|m4a|webm|ogg|flac|aac)$/i)) {
      setErrorMsg("Please select an audio file (MP3, WAV, M4A, WebM, OGG, FLAC).");
      return;
    }
    setStatus("saving");
    try {
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      await onSaveRecording({
        blob: file,
        title: customTitle.trim() || cleanName || "Imported Audio",
        folder: selectedFolder,
        kind: "uploaded",
      });
      setCustomTitle("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to import audio file.");
    } finally {
      setStatus("idle");
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Voice Recorder
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Record unlimited sessions directly to local storage with automatic Gemini transcription and structured notes.
        </p>
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
              htmlFor="rec-title"
              className="text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Session Title (optional — AI suggests one after stopping)
            </label>
            <input
              id="rec-title"
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              disabled={status === "saving"}
              placeholder="e.g., Product Roadmap Sync or Morning Idea"
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="rec-folder"
              className="text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Collection Folder
            </label>
            <div className="relative">
              <Folder className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="rec-folder"
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                disabled={status === "saving"}
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
              >
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-xs font-medium text-slate-600 dark:text-slate-400">
              {status === "recording" && (
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" />
              )}
              <span>
                {status === "idle"
                  ? "Ready to record"
                  : status === "recording"
                  ? "Recording live audio"
                  : status === "paused"
                  ? "Recording paused"
                  : "Saving to local vault..."}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {status === "recording" ? `${dbLevel} dBFS` : "Unlimited duration"}
              </span>
            </div>

            <div className="font-mono text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
              {formatPreciseTimer(elapsedMs)}
            </div>
          </div>

          <canvas
            ref={canvasRef}
            className="w-full h-28 block"
            aria-label="Live microphone waveform visualizer"
          />

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200/80 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2.5">
              {status === "idle" && (
                <button
                  type="button"
                  onClick={startRecording}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Mic className="w-4 h-4" />
                  Start Recording
                </button>
              )}

              {status === "recording" && (
                <>
                  <button
                    type="button"
                    onClick={stopAndSave}
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop & Save
                  </button>
                  <button
                    type="button"
                    onClick={pauseRecording}
                    className="inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Pause className="w-4 h-4" />
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={discardRecording}
                    className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                    Discard
                  </button>
                </>
              )}

              {status === "paused" && (
                <>
                  <button
                    type="button"
                    onClick={stopAndSave}
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop & Save
                  </button>
                  <button
                    type="button"
                    onClick={resumeRecording}
                    className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Play className="w-4 h-4" />
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={discardRecording}
                    className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                    Discard
                  </button>
                </>
              )}

              {status === "saving" && (
                <div className="inline-flex items-center gap-2 h-11 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving audio to vault...
                </div>
              )}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoAI}
                onChange={(e) => onToggleAutoAI(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-rose-600 focus:ring-rose-500"
              />
              Auto-transcribe & summarize on save
            </label>
          </div>
        </div>

        {(liveDraft || interimDraft) && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              Live Draft Preview (refined with Gemini 3.5 Transcribe on save)
            </div>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {liveDraft}{" "}
              <span className="text-slate-400 dark:text-slate-500">{interimDraft}</span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="mic-select"
              className="text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Input Device
            </label>
            <select
              id="mic-select"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={status !== "idle"}
              className="flex-1 max-w-[260px] h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 truncate"
            >
              {devices.length === 0 ? (
                <option value="">System Default Microphone</option>
              ) : (
                devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center sm:justify-end">
            <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={noiseSuppression}
                onChange={(e) => setNoiseSuppression(e.target.checked)}
                disabled={status !== "idle"}
                className="rounded border-slate-300 dark:border-slate-700 text-rose-600 focus:ring-rose-500"
              />
              Hardware noise suppression & echo cancellation
            </label>
          </div>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFileImport(file);
        }}
        className={`rounded-xl border border-dashed p-6 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors ${
          isDragging
            ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20"
            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-slate-600 dark:text-slate-400 shrink-0">
            <Upload className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Import Existing Audio File
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Drop MP3, WAV, M4A, WebM, OGG, or FLAC up to 50 MB for full AI transcription & notes.
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileImport(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={status !== "idle"}
          className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40"
        >
          Choose Audio File
        </button>
      </div>
    </div>
  );
};
