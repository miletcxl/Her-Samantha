import { describe, expect, it } from "vitest";
import { createFallbackNarration } from "../src/narration/fallback.js";
import { createOpenAICompatibleNarration } from "../src/providers/openaiCompatibleNarration.js";
import { createMockNarration } from "../src/providers/mockNarration.js";
import type { NarrationInput } from "../src/core/types.js";

const input: NarrationInput = {
  userTask: "测试任务",
  runtime: "offline",
  locale: "zh-CN",
  voiceStyle: "warm_assistant",
  trace: [],
  finalResult: { status: "completed", selectedItem: "letter_03.txt" },
  warnings: []
};

describe("OpenAICompatibleNarrationProvider", () => {
  it("parses valid provider JSON content", async () => {
    const expected = createMockNarration(input);
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(expected) } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await createOpenAICompatibleNarration(
      input,
      { baseUrl: "https://example.com/v1", model: "model", apiKey: "key" },
      fetchImpl
    );

    expect(result.spokenSummary).toBe(expected.spokenSummary);
    expect(capturedUrl).toBe("https://example.com/v1/chat/completions");
    expect(capturedInit?.headers).toMatchObject({
      authorization: "Bearer key",
      "api-key": "key"
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: "model",
      response_format: { type: "json_object" }
    });
  });

  it("supports base URLs without /v1", async () => {
    const expected = createMockNarration(input);
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(expected) } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    await createOpenAICompatibleNarration(
      input,
      { baseUrl: "https://example.com", model: "model", apiKey: "key" },
      fetchImpl
    );

    expect(capturedUrl).toBe("https://example.com/v1/chat/completions");
  });

  it("parses valid provider JSON content from a plain response", async () => {
    const expected = createMockNarration(input);
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(expected) } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    const result = await createOpenAICompatibleNarration(
      input,
      { baseUrl: "https://example.com", model: "model", apiKey: "key" },
      fetchImpl as typeof fetch
    );

    expect(result.spokenSummary).toBe(expected.spokenSummary);
  });

  it("throws on invalid JSON content so callers can fallback", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    await expect(
      createOpenAICompatibleNarration(
        input,
        { baseUrl: "https://example.com", model: "model", apiKey: "key" },
        fetchImpl as typeof fetch
      )
    ).rejects.toThrow();

    const fallback = createFallbackNarration(input, "invalid json");
    expect(fallback.fallbackUsed).toBe(true);
  });

  it("throws on HTTP failure so callers can fallback", async () => {
    const fetchImpl = async () => new Response("bad", { status: 500 });

    await expect(
      createOpenAICompatibleNarration(
        input,
        { baseUrl: "https://example.com", model: "model", apiKey: "key" },
        fetchImpl as typeof fetch
      )
    ).rejects.toThrow(/HTTP 500/);
  });
});
