import { mkdtemp, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSamanthaSession } from "../src/core/session.js";
import {
  attachJsonlReader,
  buildPiRpcArgs,
  buildPiRpcSpawnOptions,
  buildPiJsonPrintArgs,
  buildPiSpawnOptions,
  createPiProcessEnv,
  normalizePiJsonLines,
  PiRuntimeAdapter,
  resolvePiPath
} from "../src/runtimes/pi.js";

describe("Pi runtime adapter skeleton", () => {
  it("resolves Pi path from explicit path before env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "her-samantha-pi-"));
    const explicitPi = join(dir, "explicit-pi.exe");
    const envPi = join(dir, "env-pi.exe");
    await writeFile(explicitPi, "", "utf8");
    await writeFile(envPi, "", "utf8");

    await expect(
      resolvePiPath({
        cliPiPath: explicitPi,
        env: { SAMANTHA_PI_PATH: envPi, PATH: "" }
      })
    ).resolves.toBe(explicitPi);
  });

  it("resolves Pi path from SAMANTHA_PI_PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "her-samantha-pi-"));
    const envPi = join(dir, "env-pi.exe");
    await writeFile(envPi, "", "utf8");

    await expect(resolvePiPath({ env: { SAMANTHA_PI_PATH: envPi, PATH: "" } })).resolves.toBe(envPi);
  });

  it("returns a partial task result until real Pi RPC is implemented", async () => {
    const dir = await mkdtemp(join(tmpdir(), "her-samantha-pi-"));
    const piPath = join(dir, "pi.exe");
    await writeFile(piPath, "", "utf8");
    const adapter = new PiRuntimeAdapter({ piPath });

    await adapter.start();
    const result = await adapter.sendTask("Summarize the repo");

    expect(result.runtime).toBe("pi");
    expect(result.finalResult.status).toBe("partial");
    expect(result.trace.at(-1)?.type).toBe("error");
    expect(result.warnings[0]).toContain("skeleton");
  });

  it("session can run Pi skeleton through narration and artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "her-samantha-pi-"));
    const piPath = join(dir, "pi.exe");
    const outDir = join(dir, "output");
    await writeFile(piPath, "", "utf8");
    const session = createSamanthaSession();

    const result = await session.runPiTask({
      task: "Summarize the repo",
      piPath,
      voice: false,
      ttsProvider: "mock",
      narrationProvider: "mock",
      saveArtifacts: true,
      outDir
    });

    expect(result.execution.runtime).toBe("pi");
    expect(result.narration.spokenSummary).toBeTruthy();
    expect(result.voice.skipped).toBe(true);
    expect(result.artifacts.reportMarkdownPath).toBeTruthy();
  });

  it("normalizes Pi JSON mode output without including thinking content", () => {
    const stdout = [
      JSON.stringify({ type: "session", version: 3 }),
      JSON.stringify({
        type: "message_end",
        id: "user-1",
        message: {
          role: "user",
          content: [{ type: "text", text: "Summarize the repo" }]
        }
      }),
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "package.json" }
      }),
      JSON.stringify({
        type: "message_end",
        id: "assistant-1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "The repo is a TypeScript CLI." }
          ],
          stopReason: "stop"
        }
      }),
      JSON.stringify({ type: "agent_end", messages: [] })
    ].join("\n");

    const result = normalizePiJsonLines("Summarize the repo", stdout);

    expect(result.runtime).toBe("pi");
    expect(result.finalResult.status).toBe("completed");
    expect(result.finalResult.finalAnswer).toBe("The repo is a TypeScript CLI.");
    expect(JSON.stringify(result)).not.toContain("private reasoning");
    expect(result.trace.map((event) => event.type)).toEqual(["task_start", "read_file", "final"]);
  });

  it("uses non-blocking Pi JSON print spawn settings", () => {
    const env = createPiProcessEnv({
      MIMO_API_KEY: "secret",
      SAMANTHA_PI_PROVIDER: "xiaomi-token-plan-cn",
      SAMANTHA_PI_MODEL: "mimo-v2.5-pro"
    });
    const args = buildPiJsonPrintArgs("hello", env);
    const spawnOptions = buildPiSpawnOptions(env);

    expect(args).toEqual([
      "--mode",
      "json",
      "-p",
      "--provider",
      "xiaomi-token-plan-cn",
      "--model",
      "mimo-v2.5-pro",
      "hello"
    ]);
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--no-session");
    expect(args).not.toContain("--no-tools");
    expect(spawnOptions.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(env.XIAOMI_TOKEN_PLAN_CN_API_KEY).toBe("secret");
  });

  it("reports Pi RPC capabilities", () => {
    const adapter = new PiRuntimeAdapter();

    expect(adapter.getCapabilities()).toMatchObject({
      structuredEvents: true,
      toolEvents: true,
      permissionPrompts: true,
      cancel: true,
      resume: true,
      streamingOutput: true,
      sessionFiles: true,
      rpc: true,
      jsonPrintFallback: true,
      modelSwitch: true
    });
  });

  it("uses Pi RPC spawn settings with stdin pipe", () => {
    const env = createPiProcessEnv({
      MIMO_API_KEY: "secret",
      SAMANTHA_PI_PROVIDER: "xiaomi-token-plan-cn",
      SAMANTHA_PI_MODEL: "mimo-v2.5-pro"
    });

    expect(buildPiRpcArgs(env)).toEqual([
      "--mode",
      "rpc",
      "--provider",
      "xiaomi-token-plan-cn",
      "--model",
      "mimo-v2.5-pro",
      "--append-system-prompt",
      ".samantha/pi-system-prompt.md"
    ]);
    expect(buildPiRpcSpawnOptions(env).stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(env.XIAOMI_TOKEN_PLAN_CN_API_KEY).toBe("secret");
  });

  it("passes Pi native session options to RPC mode", () => {
    const args = buildPiRpcArgs(
      { SAMANTHA_PI_PROVIDER: "xiaomi-token-plan-cn", SAMANTHA_PI_MODEL: "mimo-v2.5-pro" },
      undefined,
      {
        sessionDir: "C:\\sessions",
        session: "abc123",
        continueSession: true,
        resume: true,
        fork: "fork456"
      }
    );

    expect(args).toEqual([
      "--mode",
      "rpc",
      "--provider",
      "xiaomi-token-plan-cn",
      "--model",
      "mimo-v2.5-pro",
      "--append-system-prompt",
      ".samantha/pi-system-prompt.md",
      "--session-dir",
      "C:\\sessions",
      "--session",
      "abc123",
      "--continue",
      "--resume",
      "--fork",
      "fork456"
    ]);
  });

  it("parses strict JSONL chunks without readline", () => {
    const stream = new PassThrough();
    const events: unknown[] = [];
    attachJsonlReader(stream, (event) => events.push(event));

    stream.write('{"type":"response","id":"1"}\r\n{"type":"agent_start"}\n{"type"');
    stream.write(':"agent_end"}\nnot-json\n');
    stream.end();

    expect(events).toEqual([
      { type: "response", id: "1" },
      { type: "agent_start" },
      { type: "agent_end" },
      { type: "parse_error", raw: "not-json" }
    ]);
  });
});
