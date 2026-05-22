import { describe, expect, it } from "vitest";
import { readMimoTtsConfig, readOpenAICompatibleNarrationConfig } from "../src/providers/config.js";

describe("provider config", () => {
  it("reads OpenAI-compatible narration config through apiKeyEnv pointer", () => {
    const config = readOpenAICompatibleNarrationConfig({
      SAMANTHA_NARRATION_BASE_URL: "https://example.com/",
      SAMANTHA_NARRATION_MODEL: "test-model",
      SAMANTHA_NARRATION_API_KEY_ENV: "TEST_KEY",
      TEST_KEY: "secret"
    });

    expect(config).toEqual({
      baseUrl: "https://example.com",
      model: "test-model",
      apiKey: "secret"
    });
  });

  it("fails when pointed API key env is missing", () => {
    expect(() =>
      readOpenAICompatibleNarrationConfig({
        SAMANTHA_NARRATION_BASE_URL: "https://example.com",
        SAMANTHA_NARRATION_MODEL: "test-model",
        SAMANTHA_NARRATION_API_KEY_ENV: "MISSING"
      })
    ).toThrow(/Missing API key env/);
  });

  it("reads Mimo TTS config through apiKeyEnv pointer", () => {
    const config = readMimoTtsConfig({
      SAMANTHA_TTS_BASE_URL: "https://token-plan-cn.xiaomimimo.com/v1/",
      SAMANTHA_TTS_MODEL: "mimo-v2.5-tts-voicedesign",
      SAMANTHA_TTS_VOICE_DESCRIPTION: "warm voice",
      SAMANTHA_TTS_API_KEY_ENV: "MIMO_API_KEY",
      SAMANTHA_TTS_OUTPUT_FORMAT: "mp3",
      MIMO_API_KEY: "secret"
    });

    expect(config).toEqual({
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      model: "mimo-v2.5-tts-voicedesign",
      voiceDescription: "warm voice",
      apiKey: "secret",
      outputFormat: "mp3"
    });
  });

  it("fails when Mimo TTS required config is missing", () => {
    expect(() =>
      readMimoTtsConfig({
        SAMANTHA_TTS_MODEL: "mimo-v2.5-tts-voicedesign",
        SAMANTHA_TTS_VOICE_DESCRIPTION: "warm voice",
        SAMANTHA_TTS_API_KEY_ENV: "MIMO_API_KEY",
        MIMO_API_KEY: "secret"
      })
    ).toThrow(/Missing SAMANTHA_TTS_BASE_URL/);
  });
});
