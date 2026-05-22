import { describe, expect, it } from "vitest";
import { createFallbackNarration } from "../src/narration/fallback.js";
import { collectNarrationPolicyWarnings } from "../src/narration/policy.js";
import { validateNarrationResult } from "../src/narration/validate.js";
import { createMockNarration } from "../src/providers/mockNarration.js";
import type { NarrationInput } from "../src/core/types.js";

const input: NarrationInput = {
  userTask: "测试任务",
  runtime: "offline",
  locale: "zh-CN",
  voiceStyle: "warm_assistant",
  trace: [
    {
      turnId: 1,
      type: "task_start",
      sourceRuntime: "offline",
      publicMessage: "开始",
      importance: "medium",
      status: "ok"
    }
  ],
  finalResult: { status: "completed", selectedItem: "letter_03.txt" },
  warnings: []
};

describe("narration validation and policy", () => {
  it("accepts a valid narration result", () => {
    const result = createMockNarration(input);
    expect(validateNarrationResult(result).spokenSummary).toContain("我已经读完");
  });

  it("rejects an empty spokenSummary", () => {
    const result = { ...createMockNarration(input), spokenSummary: "" };
    expect(() => validateNarrationResult(result)).toThrow(/spokenSummary/);
  });

  it("creates fallback narration", () => {
    const result = createFallbackNarration(input, "provider failed");
    expect(result.fallbackUsed).toBe(true);
    expect(result.warnings).toContain("provider failed");
  });

  it("warns on path, json, stack trace and too many file names", () => {
    const warnings = collectNarrationPolicyWarnings(
      'C:\\Users\\someone\\very\\long\\path\\letter_01.txt {"a": 1} at fn (x.js:1) a.txt b.txt c.txt'
    );
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});
