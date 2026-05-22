import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { synthesizeMimoTts } from "../src/providers/mimoTts.js";
import type { MimoTtsConfig } from "../src/providers/config.js";

const config: MimoTtsConfig = {
  baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  model: "mimo-v2.5-tts-voicedesign",
  voiceDescription: "温暖、自然、克制的中文女声助理",
  apiKey: "secret",
  outputFormat: "mp3"
};

describe("Mimo TTS provider", () => {
  it("sends only voice description and spoken summary, then writes decoded mp3", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "her-samantha-mimo-"));
    const outputPath = join(outDir, "samantha_summary.mp3");
    const audio = Buffer.from("fake mp3 bytes");
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                audio: {
                  data: audio.toString("base64")
                }
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await synthesizeMimoTts({
      spokenSummary: "这是给用户播放的短摘要。",
      outputPath,
      temporary: false,
      config,
      fetchImpl
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mimo");
    expect(capturedUrl).toBe("https://token-plan-cn.xiaomimimo.com/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      "content-type": "application/json",
      "api-key": "secret"
    });

    const body = JSON.parse(String(capturedInit?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      audio: { format: string };
    };
    expect(body).toEqual({
      model: "mimo-v2.5-tts-voicedesign",
      messages: [
        { role: "user", content: "温暖、自然、克制的中文女声助理" },
        { role: "assistant", content: "这是给用户播放的短摘要。" }
      ],
      audio: { format: "mp3" }
    });
    expect(JSON.stringify(body)).not.toContain("textDetail");
    expect(JSON.stringify(body)).not.toContain("trace");

    await expect(stat(outputPath)).resolves.toBeTruthy();
    await expect(readFile(outputPath)).resolves.toEqual(audio);
  });

  it("returns success=false on HTTP failure", async () => {
    const result = await synthesizeMimoTts({
      spokenSummary: "summary",
      outputPath: join(tmpdir(), "unused.mp3"),
      temporary: true,
      config,
      fetchImpl: async () => new Response("nope", { status: 500 })
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });

  it("returns success=false when audio data is missing", async () => {
    const result = await synthesizeMimoTts({
      spokenSummary: "summary",
      outputPath: join(tmpdir(), "unused.mp3"),
      temporary: true,
      config,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("missing choices");
  });
});
