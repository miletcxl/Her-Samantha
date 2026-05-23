import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface LoadEnvFileResult {
  loaded: boolean;
  path: string;
  keys: string[];
}

export async function loadEnvFile(
  path = ".env",
  env: NodeJS.ProcessEnv = process.env,
  options: { overwrite?: boolean } = {}
): Promise<LoadEnvFileResult> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return { loaded: false, path, keys: [] };
    }
    throw error;
  }

  const parsed = parseEnvFile(content);
  const keys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (options.overwrite || env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, path, keys };
}

export async function appendToEnvFile(path: string, key: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const escaped = value.includes('"') ? `'${value}'` : `"${value}"`;
  await appendFile(path, `${key}=${escaped}\n`, "utf8");
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = withoutExport.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawValue = withoutExport.slice(equalsIndex + 1).trim();
    result[key] = parseEnvValue(rawValue);
  }

  return result;
}

function parseEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(" #");
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
