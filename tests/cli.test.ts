import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("cli", () => {
  it("runs offline command and writes artifacts", async () => {
    const outDir = join(tmpdir(), `her-samantha-cli-${Date.now()}`);
    const { stdout } = await execFileAsync(process.execPath, [
      "dist/cli.js",
      "run",
      "offline",
      "examples/letters_task.json",
      "--tts",
      "mock",
      "--voice",
      "--save-artifacts",
      "--out",
      outDir
    ]);

    expect(stdout).toContain("Spoken summary:");
    expect(stdout).toContain("Files:");

    const runs = await readdir(outDir);
    expect(runs.length).toBe(1);
    const runDir = join(outDir, runs[0]!);
    await expect(stat(join(runDir, "report.md"))).resolves.toBeTruthy();
    await expect(stat(join(runDir, "report.json"))).resolves.toBeTruthy();
    await expect(stat(join(runDir, "trace.normalized.json"))).resolves.toBeTruthy();
    const audio = await stat(join(runDir, "samantha_summary.wav"));
    expect(audio.size).toBeGreaterThan(44);
  }, 30_000);

  it("runs listen pi once with a task and fake Pi path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "her-samantha-cli-pi-"));
    const piPath = join(tempDir, "pi.exe");
    const outDir = join(tempDir, "output");
    await writeFile(piPath, "", "utf8");

    const envPatch = { ...process.env };
    delete envPatch.SAMANTHA_NARRATION_BASE_URL;
    delete envPatch.SAMANTHA_NARRATION_MODEL;
    delete envPatch.SAMANTHA_NARRATION_API_KEY_ENV;

    const { stdout } = await execFileAsync(process.execPath, [
      "dist/cli.js",
      "listen",
      "pi",
      "--pi-path",
      piPath,
      "--task",
      "Summarize the repo",
      "--tts",
      "mock",
      "--no-voice",
      "--save-artifacts",
      "--out",
      outDir
    ], { env: envPatch });

    expect(stdout).toContain("Spoken summary:");
    expect(stdout).toMatch(/Spoken summary:\s*\n\s*\S+/);
    const runs = await readdir(outDir);
    expect(runs.length).toBe(1);
    await expect(stat(join(outDir, runs[0]!, "report.json"))).resolves.toBeTruthy();
  }, 30_000);
});
