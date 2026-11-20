import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "GEMINI_API_KEY is not configured. Please verify your API key in Settings > Secrets."
    ) as Error & { status?: number };
    err.status = 500;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function normalizeAudioMimeType(rawMime?: string): string {
  const clean = (rawMime || "audio/webm").split(";")[0].trim().toLowerCase();
  if (clean === "audio/mpeg" || clean === "audio/mp3") return "audio/mp3";
  if (clean === "audio/x-wav" || clean === "audio/wave" || clean === "audio/wav") return "audio/wav";
  if (clean === "audio/x-m4a" || clean === "audio/m4a" || clean === "audio/mp4") return "audio/mp4";
  if (clean === "audio/ogg" || clean === "audio/opus") return "audio/ogg";
  if (clean === "audio/flac") return "audio/flac";
  if (clean === "audio/aac") return "audio/aac";
  if (clean.startsWith("video/webm")) return "audio/webm";
  return clean.startsWith("audio/") ? clean : "audio/webm";
}

function formatApiError(err: unknown): { status: number; message: string } {
  const anyErr = err as { status?: number; code?: number; message?: string };
  const rawMsg = anyErr?.message || "Unexpected server error while calling Gemini API.";
  const status = typeof anyErr?.status === "number" ? anyErr.status : typeof anyErr?.code === "number" ? anyErr.code : 500;

  if (status === 403 || rawMsg.includes("PERMISSION_DENIED")) {
    return {
      status: 403,
      message: "API key permission denied. Check your API key in Settings > Secrets.",
    };
  }
  if (status === 400 && rawMsg.includes("API_KEY_INVALID")) {
    return {
      status: 400,
      message: "Invalid Gemini API key. Check your API key in Settings > Secrets.",
    };
  }
  if (status === 429 || rawMsg.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Rate limit or quota reached. Please wait a moment and try again.",
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMsg,
  };
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const anyErr = err as { status?: number; message?: string };
      const status = anyErr?.status ?? 500;
      const retryable = status === 429 || status === 503 || status >= 500;
      if (!retryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

async function createServer() {
  const app = express();

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  // Raw binary upload for unlimited-length audio recordings up to 50MB
  app.post(
    "/api/transcribe",
    express.raw({
      type: ["application/octet-stream", "audio/*", "video/webm"],
      limit: "50mb",
    }),
    async (req: Request, res: Response) => {
      try {
        const buffer = req.body as Buffer;
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
          res.status(400).json({ error: "Empty audio payload received." });
          return;
        }

        const rawMime = req.header("x-audio-mime-type") || req.header("content-type");
        const mimeType = normalizeAudioMimeType(rawMime);
        const hint = req.header("x-transcribe-hint") || "";

        const ai = getAIClient();
        const base64Audio = buffer.toString("base64");

        const instruction = hint
          ? `Transcribe this audio verbatim with clean punctuation and paragraph breaks. Additional context: ${hint}`
          : "Transcribe this audio accurately verbatim with clean punctuation, paragraph breaks, and speaker labels if multiple speakers are clearly distinguishable.";

        const response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-3.5-transcribe",
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Audio,
                  },
                },
                { text: instruction },
              ],
            },
          })
        );

        const transcript = (response.text ?? "").trim();
        res.json({ transcript });
      } catch (err) {
        const formatted = formatApiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  app.use(express.json({ limit: "15mb" }));

  app.post("/api/analyze", async (req: Request, res: Response) => {
    try {
      const { transcript, existingTitle } = req.body as {
        transcript?: string;
        existingTitle?: string;
      };

      if (!transcript || !transcript.trim()) {
        res.status(400).json({ error: "A non-empty transcript is required for analysis." });
        return;
      }

      const ai = getAIClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `Analyze the following voice recording transcript and extract a concise title, a 1-2 sentence TL;DR summary, key takeaways, concrete action items, and up to 4 short topic keywords.\n\nExisting title hint: ${existingTitle || "None"}\n\nTranscript:\n${transcript}`,
          config: {
            systemInstruction:
              "You are an expert audio intelligence editor. Return crisp, accurate, grounded insights directly from the transcript without inventing facts.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                suggestedTitle: {
                  type: Type.STRING,
                  description: "A concise 3-7 word title capturing the core subject.",
                },
                tldr: {
                  type: Type.STRING,
                  description: "A clear 1-2 sentence summary of the recording.",
                },
                keyPoints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "3 to 6 concise key takeaways or main points.",
                },
                actionItems: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Concrete next steps, tasks, or follow-ups mentioned (empty array if none).",
                },
                topics: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Up to 4 short 1-2 word topic keywords.",
                },
              },
              required: ["suggestedTitle", "tldr", "keyPoints", "actionItems", "topics"],
            },
          },
        })
      );

      const raw = (response.text ?? "{}").trim();
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post("/api/transform", async (req: Request, res: Response) => {
    try {
      const { transcript, mode, customPrompt } = req.body as {
        transcript?: string;
        mode?: string;
        customPrompt?: string;
      };

      if (!transcript || !transcript.trim()) {
        res.status(400).json({ error: "A transcript is required to transform." });
        return;
      }

      const modeInstructions: Record<string, string> = {
        email:
          "Turn this voice recording into a clear, well-structured professional email with a Subject line, concise greeting, body paragraphs/bullets, and sign-off.",
        minutes:
          "Format this voice recording as clean Meeting Minutes with Date/Context, Decisions Made, Discussion Summary, and Action Items.",
        outline:
          "Convert this voice recording into a hierarchical structured outline with clear headings and concise bullet points.",
        article:
          "Rewrite this voice recording into a polished, engaging long-form article or blog post keeping the speaker's core voice and ideas.",
        cleanup:
          "Polish and clean up this transcript into fluent written prose: remove filler words (um, uh, like), fix grammar, and organize into crisp paragraphs while preserving 100% of the meaning.",
        custom: customPrompt?.trim() || "Summarize and organize this transcript clearly.",
      };

      const prompt = modeInstructions[mode || "custom"] || modeInstructions.custom;
      const ai = getAIClient();

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `${prompt}\n\nSource Transcript:\n${transcript}`,
          config: {
            systemInstruction:
              "You transform spoken voice recordings into clear, publication-ready written outputs. Stay faithful to the source transcript.",
          },
        })
      );

      res.json({ output: (response.text ?? "").trim() });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post("/api/ask", async (req: Request, res: Response) => {
    try {
      const { contexts, history, question } = req.body as {
        contexts?: Array<{ id: string; title: string; date: string; transcript: string }>;
        history?: Array<{ role: "user" | "assistant"; text: string }>;
        question?: string;
      };

      if (!question || !question.trim()) {
        res.status(400).json({ error: "Question is required." });
        return;
      }

      if (!contexts || contexts.length === 0) {
        res.status(400).json({ error: "At least one transcribed recording is required." });
        return;
      }

      const contextBlock = contexts
        .map(
          (c, i) =>
            `[Recording ${i + 1}: "${c.title}" (${c.date})]\n${c.transcript.slice(0, 24000)}`
        )
        .join("\n\n---\n\n");

      const historyBlock = (history || [])
        .slice(-8)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n");

      const ai = getAIClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `Recordings Context:\n${contextBlock}\n\n${
            historyBlock ? `Recent Conversation:\n${historyBlock}\n\n` : ""
          }Current Question: ${question}`,
          config: {
            systemInstruction:
              "You answer questions strictly based on the user's voice recordings provided in the context. When referencing information across multiple recordings, cite the recording title naturally in your answer. If the answer isn't in the recordings, state that clearly.",
          },
        })
      );

      res.json({ answer: (response.text ?? "").trim() });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post("/api/tts/single", async (req: Request, res: Response) => {
    try {
      const { text, voiceName, style } = req.body as {
        text?: string;
        voiceName?: string;
        style?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: "Text is required to generate an AI voice recording." });
        return;
      }

      const allowedVoices = ["Kore", "Puck", "Charon", "Fenrir", "Zephyr"];
      const chosenVoice = allowedVoices.includes(voiceName || "") ? voiceName! : "Kore";

      const ai = getAIClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-3.8-flash-lite-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: text.trim(),
                  ...(style?.trim()
                    ? { speechMetadata: { style: style.trim() } }
                    : {}),
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: chosenVoice },
              },
            },
          },
        })
      );

      const audioBase64 =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioBase64) {
        res.status(502).json({ error: "No audio data was returned by the speech model." });
        return;
      }

      res.json({ audioBase64, mimeType: "audio/wav" });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post("/api/tts/dialogue", async (req: Request, res: Response) => {
    try {
      const { lines, speakerA, speakerB } = req.body as {
        lines?: Array<{ speaker: string; text: string }>;
        speakerA?: { name: string; voiceName: string; style?: string };
        speakerB?: { name: string; voiceName: string; style?: string };
      };

      if (!lines || lines.length === 0 || !speakerA?.name || !speakerB?.name) {
        res.status(400).json({ error: "Dialogue lines and both speaker configurations are required." });
        return;
      }

      const allowedVoices = ["Kore", "Puck", "Charon", "Fenrir", "Zephyr"];
      const voiceA = allowedVoices.includes(speakerA.voiceName) ? speakerA.voiceName : "Puck";
      const voiceB = allowedVoices.includes(speakerB.voiceName) ? speakerB.voiceName : "Kore";

      const parts = lines
        .filter((l) => l.text.trim().length > 0)
        .map((line) => {
          const isA = line.speaker === speakerA.name;
          const style = isA ? speakerA.style : speakerB.style;
          return {
            text: `${line.speaker}: ${line.text.trim()}`,
            speechMetadata: {
              speaker: line.speaker,
              ...(style?.trim() ? { style: style.trim() } : {}),
            },
          };
        });

      if (parts.length === 0) {
        res.status(400).json({ error: "Dialogue contains no non-empty spoken lines." });
        return;
      }

      const ai = getAIClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: speakerA.name,
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceA },
                    },
                  },
                  {
                    speaker: speakerB.name,
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceB },
                    },
                  },
                ],
              },
            },
          },
        })
      );

      const audioBase64 =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioBase64) {
        res.status(502).json({ error: "No audio data was returned by the dialogue speech model." });
        return;
      }

      res.json({ audioBase64, mimeType: "audio/wav" });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`EchoVault server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
