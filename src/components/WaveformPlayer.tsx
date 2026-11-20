import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { formatDuration } from "../lib/audioUtils";

interface WaveformPlayerProps {
  audioBlob: Blob | null;
  peaks: number[];
  durationSec: number;
  title?: string;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export const WaveformPlayer: React.FC<WaveformPlayerProps> = ({
  audioBlob,
  peaks,
  durationSec,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSec);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setTotalDuration(durationSec);
  }, [durationSec]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (!audioBlob) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioBlob]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    audio.muted = muted;
  }, [playbackRate, muted, objectUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !objectUrl) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const seekBy = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const effectiveDur =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : totalDuration;
    const next = Math.max(0, Math.min(effectiveDur || 0, audio.currentTime + delta));
    audio.currentTime = next;
    setCurrentTime(next);
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    const audio = audioRef.current;
    if (!el || !audio) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const effectiveDur =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : totalDuration;
    if (effectiveDur > 0) {
      const target = ratio * effectiveDur;
      audio.currentTime = target;
      setCurrentTime(target);
    }
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
  };

  const effectiveDuration = totalDuration > 0 ? totalDuration : 0;
  const progress =
    effectiveDuration > 0 ? Math.min(1, currentTime / effectiveDuration) : 0;

  const displayPeaks =
    peaks && peaks.length > 0
      ? peaks
      : Array.from({ length: 88 }, (_, i) => 0.25 + 0.3 * Math.abs(Math.sin(i * 0.4)));

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      {objectUrl && (
        <audio
          ref={audioRef}
          src={objectUrl}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setTotalDuration(d);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      )}

      <div className="flex flex-col gap-4">
        <div
          ref={trackRef}
          onClick={handleScrub}
          role="slider"
          aria-label="Audio playback timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDuration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seekBy(5);
            if (e.key === "ArrowLeft") seekBy(-5);
            if (e.key === " ") {
              e.preventDefault();
              void togglePlay();
            }
          }}
          className="relative h-16 flex items-center gap-[2px] cursor-pointer select-none px-1 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800/80 focus-visible:outline-2 focus-visible:outline-rose-600"
        >
          {displayPeaks.map((amp, i) => {
            const barRatio = i / displayPeaks.length;
            const active = barRatio <= progress;
            const heightPct = Math.max(12, Math.min(92, Math.round(amp * 92)));
            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-colors duration-100 ${
                  active
                    ? "bg-rose-600 dark:bg-rose-500"
                    : "bg-slate-300 dark:bg-slate-700"
                }`}
                style={{ height: `${heightPct}%` }}
              />
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!objectUrl}
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-40 transition-colors cursor-pointer shrink-0"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              disabled={!objectUrl}
              title="Back 10 seconds"
              aria-label="Rewind 10 seconds"
              className="inline-flex items-center justify-center h-10 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer text-xs font-mono whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              10s
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              disabled={!objectUrl}
              title="Forward 10 seconds"
              aria-label="Forward 10 seconds"
              className="inline-flex items-center justify-center h-10 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer text-xs font-mono whitespace-nowrap shrink-0"
            >
              10s
              <RotateCw className="w-3.5 h-3.5 ml-1" />
            </button>

            <div className="ml-2 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
              <span className="text-slate-900 dark:text-slate-100 font-medium">
                {formatDuration(currentTime)}
              </span>
              <span className="mx-1.5 text-slate-400">/</span>
              <span>{formatDuration(effectiveDuration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${playbackRate}x`}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-mono font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {playbackRate}x
            </button>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute" : "Mute"}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
