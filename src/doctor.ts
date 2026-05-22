import { spawn } from "node:child_process";
import { readMimoTtsConfig, readOpenAICompatibleNarrationConfig } from "./providers/config.js";
import { resolvePiPath } from "./runtimes/pi.js";

export async function runDoctor(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const lines = ["Her-Samantha doctor", ""];

  await addCheck(lines, "Narration config", () => {
    const config = readOpenAICompatibleNarrationConfig(env);
    return `ok (${config.baseUrl}, ${config.model})`;
  });

  await addCheck(lines, "TTS config", () => {
    const config = readMimoTtsConfig(env);
    return `ok (${config.baseUrl}, ${config.model}, ${config.outputFormat})`;
  });

  let piPath: string | undefined;
  await addCheck(lines, "Pi executable", async () => {
    piPath = await resolvePiPath({ env });
    return `ok (${piPath})`;
  });

  if (piPath) {
    await addCheck(lines, "Pi version", async () => {
      const result = await runProcess(piPath!, ["--version"], env, 10_000);
      if (result.timedOut) return "failed (timed out)";
      if (result.exitCode !== 0) return `failed (exit ${result.exitCode})`;
      return `ok (${result.stdout.trim() || "unknown"})`;
    });
  }

  return `${lines.join("\n")}\n`;
}

async function addCheck(lines: string[], label: string, check: () => string | Promise<string>): Promise<void> {
  try {
    lines.push(`- ${label}: ${await check()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`- ${label}: failed (${message})`);
  }
}

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}
