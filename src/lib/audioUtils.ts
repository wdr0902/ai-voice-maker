export function generateId(prefix = "rec"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  const rounded = Math.floor(totalSeconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function formatPreciseTimer(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00:00.0";
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const secs = totalSec % 60;
  const mins = Math.floor(totalSec / 60) % 60;
  const hrs = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${tenths}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 10 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export function formatRelativeDate(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: days > 300 ? "numeric" : undefined,
  });
}

export function base64ToBlob(base64: string, mimeType = "audio/wav"): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export async function analyzeAudioBlob(
  blob: Blob,
  barCount = 88
): Promise<{ durationSec: number; peaks: number[] }> {
  const fallbackPeaks = Array.from({ length: barCount }, (_, idx) =>
    Number((0.2 + 0.35 * Math.abs(Math.sin(idx * 0.45))).toFixed(3))
  );

  let durationSec = 0;
  try {
    durationSec = await getAudioElementDuration(blob);
  } catch {
    durationSec = 0;
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return { durationSec, peaks: fallbackPeaks };
    }
    const ctx = new AudioCtx();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const actualDuration = Number.isFinite(audioBuffer.duration)
        ? audioBuffer.duration
        : durationSec;
      const channelData = audioBuffer.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(channelData.length / barCount));
      const rawPeaks: number[] = [];
      let maxVal = 0;

      for (let i = 0; i < barCount; i++) {
        const start = i * blockSize;
        const end = Math.min(channelData.length, start + blockSize);
        let sum = 0;
        let count = 0;
        const step = Math.max(1, Math.floor((end - start) / 64));
        for (let j = start; j < end; j += step) {
          const v = Math.abs(channelData[j]);
          sum += v;
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        if (avg > maxVal) maxVal = avg;
        rawPeaks.push(avg);
      }

      const norm = maxVal > 0.001 ? maxVal : 1;
      const peaks = rawPeaks.map((p) =>
        Number(Math.max(0.08, Math.min(1, p / norm)).toFixed(3))
      );

      return { durationSec: actualDuration, peaks };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch {
    return { durationSec, peaks: fallbackPeaks };
  }
}

function getAudioElementDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (audio.duration === Infinity) {
        audio.currentTime = 1e10;
        audio.ontimeupdate = () => {
          audio.ontimeupdate = null;
          const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
          cleanup();
          resolve(dur);
        };
      } else {
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        cleanup();
        resolve(dur);
      }
    };
    audio.onerror = () => {
      cleanup();
      resolve(0);
    };
    audio.src = url;
  });
}

export function getExtensionForMime(mimeType: string): string {
  const clean = mimeType.split(";")[0].toLowerCase();
  if (clean.includes("wav")) return "wav";
  if (clean.includes("mp3") || clean.includes("mpeg")) return "mp3";
  if (clean.includes("mp4") || clean.includes("m4a")) return "m4a";
  if (clean.includes("ogg")) return "ogg";
  if (clean.includes("flac")) return "flac";
  return "webm";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, filename);
}
