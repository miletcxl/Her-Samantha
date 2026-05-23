import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendToEnvFile } from "../config/envFile.js";

export interface OpenAICompatibleNarrationConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface MimoTtsConfig {
  baseUrl: string;
  model: string;
  voiceDescription: string;
  apiKey: string;
  outputFormat: "mp3" | "wav";
}

export interface ProviderEntry {
  baseUrl: string;
  model: string;
  apiKeyRef: string;
  voiceDescription?: string;
  outputFormat?: "mp3" | "wav";
}

export interface CapabilityRegistry {
  active: string;
  providers: Record<string, ProviderEntry>;
}

export interface ProviderRegistry {
  narration?: CapabilityRegistry;
  tts?: CapabilityRegistry;
}

const REGISTRY_PATH = join(".samantha", "providers.json");

export function registryPath(cwd?: string): string {
  return cwd ? join(cwd, ".samantha", "providers.json") : REGISTRY_PATH;
}

export async function loadProviderRegistry(path?: string): Promise<ProviderRegistry | null> {
  let content: string;
  try {
    content = await readFile(path ?? REGISTRY_PATH, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  const parsed = JSON.parse(content) as unknown;
  return validateRegistry(parsed);
}

export async function saveProviderRegistry(registry: ProviderRegistry, path?: string): Promise<void> {
  const target = path ?? REGISTRY_PATH;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

export function resolveNarrationConfig(
  registry: ProviderRegistry,
  env: NodeJS.ProcessEnv
): OpenAICompatibleNarrationConfig | null {
  const capability = registry.narration;
  if (!capability) return null;
  const entry = capability.providers[capability.active];
  if (!entry) return null;
  const apiKey = resolveApiKey(entry.apiKeyRef, env);
  if (!apiKey) return null;
  return {
    baseUrl: entry.baseUrl.replace(/\/+$/, ""),
    model: entry.model,
    apiKey
  };
}

export function resolveTtsConfig(
  registry: ProviderRegistry,
  env: NodeJS.ProcessEnv
): MimoTtsConfig | null {
  const capability = registry.tts;
  if (!capability) return null;
  const entry = capability.providers[capability.active];
  if (!entry) return null;
  const apiKey = resolveApiKey(entry.apiKeyRef, env);
  if (!apiKey) return null;
  return {
    baseUrl: entry.baseUrl.replace(/\/+$/, ""),
    model: entry.model,
    voiceDescription: entry.voiceDescription ?? "warm natural Chinese female voice",
    apiKey,
    outputFormat: entry.outputFormat ?? "mp3"
  };
}

export function resolveApiKey(ref: string, env: NodeJS.ProcessEnv): string | undefined {
  if (ref.startsWith("env:")) {
    const varName = ref.slice(4);
    const value = env[varName];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return undefined;
}

export function autoGenerateKeyEnvName(providerName: string, capability: string): string {
  const prefix = providerName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `${prefix}_API_KEY`;
}

export async function writeLocalEnv(
  key: string,
  value: string,
  path?: string
): Promise<void> {
  await appendToEnvFile(path ?? ".samantha/.env.local", key, value);
}

export async function testProviderConnection(
  entry: ProviderEntry,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  const url = entry.baseUrl.endsWith("/v1")
    ? `${entry.baseUrl}/chat/completions`
    : `${entry.baseUrl}/v1/chat/completions`;

  const start = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: entry.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(10_000)
    });

    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`, latencyMs };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, latencyMs };
  }
}

function validateRegistry(value: unknown): ProviderRegistry {
  if (!isRecord(value)) throw new Error("Provider registry must be a JSON object.");
  const registry: ProviderRegistry = {};
  if ("narration" in value && value.narration !== undefined) {
    registry.narration = validateCapability(value.narration, "narration");
  }
  if ("tts" in value && value.tts !== undefined) {
    registry.tts = validateCapability(value.tts, "tts");
  }
  return registry;
}

function validateCapability(value: unknown, kind: string): CapabilityRegistry {
  if (!isRecord(value)) throw new Error(`${kind} capability must be an object.`);
  if (typeof value.active !== "string" || value.active.length === 0) {
    throw new Error(`${kind} capability must have a non-empty "active" string.`);
  }
  if (!isRecord(value.providers)) {
    throw new Error(`${kind} capability must have a "providers" object.`);
  }
  const providers: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(value.providers)) {
    providers[name] = validateProviderEntry(entry, name);
  }
  if (!providers[value.active]) {
    throw new Error(`${kind} active provider "${value.active}" not found in providers.`);
  }
  return { active: value.active, providers };
}

export function validateProviderEntry(value: unknown, name: string): ProviderEntry {
  if (!isRecord(value)) throw new Error(`Provider "${name}" must be an object.`);
  const baseUrl = value.baseUrl;
  const model = value.model;
  const apiKeyRef = value.apiKeyRef;
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error(`Provider "${name}" must have a non-empty "baseUrl".`);
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new Error(`Provider "${name}" must have a non-empty "model".`);
  }
  if (typeof apiKeyRef !== "string" || apiKeyRef.length === 0) {
    throw new Error(`Provider "${name}" must have a non-empty "apiKeyRef".`);
  }
  const entry: ProviderEntry = { baseUrl, model, apiKeyRef };
  if (typeof value.voiceDescription === "string" && value.voiceDescription.length > 0) {
    entry.voiceDescription = value.voiceDescription;
  }
  if (value.outputFormat === "mp3" || value.outputFormat === "wav") {
    entry.outputFormat = value.outputFormat;
  }
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
