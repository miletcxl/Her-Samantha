import type { MimoTtsConfig, OpenAICompatibleNarrationConfig } from "./registry.js";
import { loadProviderRegistry, resolveNarrationConfig, resolveTtsConfig } from "./registry.js";

export type { MimoTtsConfig, OpenAICompatibleNarrationConfig };

export function hasTtsEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    typeof env.SAMANTHA_TTS_BASE_URL === "string" &&
    typeof env.SAMANTHA_TTS_MODEL === "string" &&
    typeof env.SAMANTHA_TTS_API_KEY_ENV === "string"
  );
}

export function hasNarrationEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    typeof env.SAMANTHA_NARRATION_BASE_URL === "string" &&
    typeof env.SAMANTHA_NARRATION_MODEL === "string" &&
    typeof env.SAMANTHA_NARRATION_API_KEY_ENV === "string"
  );
}

export function readOpenAICompatibleNarrationConfig(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleNarrationConfig {
  const baseUrl = env.SAMANTHA_NARRATION_BASE_URL;
  const model = env.SAMANTHA_NARRATION_MODEL;
  const apiKeyEnv = env.SAMANTHA_NARRATION_API_KEY_ENV;
  if (!baseUrl) throw new Error("Missing SAMANTHA_NARRATION_BASE_URL.");
  if (!model) throw new Error("Missing SAMANTHA_NARRATION_MODEL.");
  if (!apiKeyEnv) throw new Error("Missing SAMANTHA_NARRATION_API_KEY_ENV.");
  const apiKey = env[apiKeyEnv];
  if (!apiKey) throw new Error(`Missing API key env referenced by SAMANTHA_NARRATION_API_KEY_ENV: ${apiKeyEnv}.`);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey
  };
}

export function readMimoTtsConfig(env: NodeJS.ProcessEnv = process.env): MimoTtsConfig {
  const baseUrl = env.SAMANTHA_TTS_BASE_URL;
  const model = env.SAMANTHA_TTS_MODEL;
  const voiceDescription = env.SAMANTHA_TTS_VOICE_DESCRIPTION;
  const apiKeyEnv = env.SAMANTHA_TTS_API_KEY_ENV;
  const outputFormat = env.SAMANTHA_TTS_OUTPUT_FORMAT ?? "mp3";

  if (!baseUrl) throw new Error("Missing SAMANTHA_TTS_BASE_URL.");
  if (!model) throw new Error("Missing SAMANTHA_TTS_MODEL.");
  if (!voiceDescription) throw new Error("Missing SAMANTHA_TTS_VOICE_DESCRIPTION.");
  if (!apiKeyEnv) throw new Error("Missing SAMANTHA_TTS_API_KEY_ENV.");
  if (outputFormat !== "mp3" && outputFormat !== "wav") {
    throw new Error("SAMANTHA_TTS_OUTPUT_FORMAT must be mp3 or wav.");
  }

  const apiKey = env[apiKeyEnv];
  if (!apiKey) throw new Error(`Missing API key env referenced by SAMANTHA_TTS_API_KEY_ENV: ${apiKeyEnv}.`);

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    voiceDescription,
    apiKey,
    outputFormat
  };
}

export async function readNarrationConfigFromRegistry(
  env: NodeJS.ProcessEnv = process.env
): Promise<OpenAICompatibleNarrationConfig> {
  const registry = await loadProviderRegistry();
  if (registry) {
    const resolved = resolveNarrationConfig(registry, env);
    if (resolved) return resolved;
  }
  return readOpenAICompatibleNarrationConfig(env);
}

export async function readTtsConfigFromRegistry(
  env: NodeJS.ProcessEnv = process.env
): Promise<MimoTtsConfig> {
  const registry = await loadProviderRegistry();
  if (registry) {
    const resolved = resolveTtsConfig(registry, env);
    if (resolved) return resolved;
  }
  return readMimoTtsConfig(env);
}
