import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { VoiceOutputResult } from "../core/types.js";
import type { MimoTtsConfig } from "./config.js";

export async function synthesizeMimoTts(options: {
  spokenSummary: string;
  outputPath: string;
  temporary: boolean;
  config: MimoTtsConfig;
  fetchImpl?: typeof fetch;
}): Promise<VoiceOutputResult> {
  if (options.spokenSummary.length === 0) {
    return createFailure(options.temporary, "spokenSummary is empty.");
  }

  const fetcher = options.fetchImpl ?? fetch;

  try {
    const response = await fetcher(`${options.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": options.config.apiKey
      },
      body: JSON.stringify({
        model: options.config.model,
        messages: [
          {
            role: "user",
            content: options.config.voiceDescription
          },
          {
            role: "assistant",
            content: options.spokenSummary
          }
        ],
        audio: {
          format: options.config.outputFormat
        }
      })
    });

    if (!response.ok) {
      return createFailure(options.temporary, `Mimo TTS HTTP ${response.status}.`);
    }

    const json = (await response.json()) as unknown;
    const audioData = extractAudioData(json);
    if (!audioData) {
      return createFailure(options.temporary, "Mimo TTS response missing choices[0].message.audio.data.");
    }

    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, Buffer.from(audioData, "base64"));

    return {
      requested: true,
      skipped: false,
      success: true,
      provider: "mimo",
      audioPath: options.outputPath,
      temporary: options.temporary,
      played: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailure(options.temporary, `Mimo TTS failed: ${message}`);
  }
}

function createFailure(temporary: boolean, error: string): VoiceOutputResult {
  return {
    requested: true,
    skipped: false,
    success: false,
    provider: "mimo",
    temporary,
    played: false,
    error
  };
}

function extractAudioData(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const choices = value.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (!isRecord(first)) return undefined;
  const message = first.message;
  if (!isRecord(message)) return undefined;
  const audio = message.audio;
  if (!isRecord(audio)) return undefined;
  return typeof audio.data === "string" && audio.data.length > 0 ? audio.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
