import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { VoiceOutputResult } from "../core/types.js";

export async function synthesizeMockTts(options: {
  spokenSummary: string;
  outputPath: string;
  temporary: boolean;
}): Promise<VoiceOutputResult> {
  if (options.spokenSummary.length === 0) {
    return {
      requested: true,
      skipped: false,
      success: false,
      provider: "mock",
      temporary: options.temporary,
      played: false,
      error: "spokenSummary is empty."
    };
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, createSilentWav());

  return {
    requested: true,
    skipped: false,
    success: true,
    provider: "mock",
    audioPath: options.outputPath,
    temporary: options.temporary,
    played: false,
    durationMs: 120
  };
}

function createSilentWav(): Buffer {
  const sampleRate = 8000;
  const durationSeconds = 0.12;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
