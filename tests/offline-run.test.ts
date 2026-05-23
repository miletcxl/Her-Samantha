import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSamanthaSession } from "../src/core/session.js";

describe("offline run", () => {
  it("runs the offline letters flow with mock voice and artifacts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "her-samantha-test-"));
    const session = createSamanthaSession();

    const result = await session.runOffline({
      inputPath: "asset/examples/letters_task.json",
      voice: true,
      ttsProvider: "mock",
      saveArtifacts: true,
      outDir
    });

    expect(result.narration.spokenSummary).toContain("我已经读完这些信件");
    expect(result.narration.textDetail.lettersDemo?.selectedLetter).toBe("letter_03.txt");
    expect(result.trace).toHaveLength(7);
    expect(result.voice.success).toBe(true);
    expect(result.voice.audioPath).toBeTruthy();
    expect(result.artifacts.reportMarkdownPath).toBeTruthy();
    expect(result.artifacts.reportJsonPath).toBeTruthy();
    expect(result.artifacts.normalizedTracePath).toBeTruthy();

    const audio = await stat(result.voice.audioPath!);
    expect(audio.size).toBeGreaterThan(44);
  });

  it("does not write artifacts when artifact mode is disabled", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "her-samantha-test-"));
    const session = createSamanthaSession();

    const result = await session.runOffline({
      inputPath: "asset/examples/letters_task.json",
      voice: false,
      ttsProvider: "mock",
      saveArtifacts: false,
      outDir
    });

    expect(result.artifacts.enabled).toBe(false);
    expect(result.voice.skipped).toBe(true);
    expect(result.voice.audioPath).toBeUndefined();
  });

  it("does not fail the main flow when Mimo TTS config is missing", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "her-samantha-test-"));
    const session = createSamanthaSession();
    const originalBaseUrl = process.env.SAMANTHA_TTS_BASE_URL;
    delete process.env.SAMANTHA_TTS_BASE_URL;

    try {
      const result = await session.runOffline({
        inputPath: "asset/examples/letters_task.json",
        voice: true,
        ttsProvider: "mimo",
        saveArtifacts: true,
        outDir
      });

      expect(result.state.taskStatus).toBe("completed");
      expect(result.voice.success).toBe(false);
      expect(result.voice.provider).toBe("mimo");
      expect(result.voice.error).toContain("Missing SAMANTHA_TTS_BASE_URL");
    } finally {
      if (originalBaseUrl) process.env.SAMANTHA_TTS_BASE_URL = originalBaseUrl;
    }
  });
});
