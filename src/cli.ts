#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnvFile } from "./config/envFile.js";
import { runDoctor } from "./doctor.js";
import { renderTerminalSummary } from "./renderer/terminal.js";
import { createSamanthaSession } from "./core/session.js";
import type { RunOfflineOptions, RunPiTaskOptions } from "./core/types.js";

async function main(argv: string[]): Promise<number> {
  await loadEnvFile();

  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    process.stdout.write(helpText());
    return 0;
  }

  const parsed = parseArgs(argv);
  if (parsed.command === "doctor") {
    process.stdout.write(await runDoctor());
    return 0;
  }

  if (parsed.command === "run-offline") {
    const session = createSamanthaSession();
    const result = await session.runOffline(parsed.options);
    process.stdout.write(
      renderTerminalSummary({
        narration: result.narration,
        voice: result.voice,
        artifacts: result.artifacts
      })
    );
    return 0;
  }

  return listenPi(parsed.options);
}

type ParsedCli =
  | { command: "doctor" }
  | { command: "run-offline"; options: RunOfflineOptions }
  | { command: "listen-pi"; options: ListenPiOptions };

type ListenPiOptions = Omit<RunPiTaskOptions, "task"> & { task?: string };

function parseArgs(argv: string[]): ParsedCli {
  const [command, maybeRuntimeOrFile, maybeFile, ...rest] = argv;
  if (command === "doctor") {
    return { command: "doctor" };
  }

  if (command === "listen" && maybeRuntimeOrFile === "pi") {
    return { command: "listen-pi", options: parseListenPiArgs([maybeFile, ...rest]) };
  }

  if (command !== "run") {
    throw new Error(`Unsupported command: ${command ?? ""}`);
  }

  let inputPath: string | undefined;
  let args: string[];
  if (maybeRuntimeOrFile === "offline") {
    inputPath = maybeFile;
    args = rest;
  } else {
    inputPath = maybeRuntimeOrFile;
    args = [maybeFile, ...rest].filter((value): value is string => typeof value === "string");
  }

  if (!inputPath) {
    throw new Error("Missing offline trace file. Usage: samantha run offline <file>");
  }

  const shared = parseSharedOptions(args);

  return {
    command: "run-offline",
    options: {
      inputPath,
      ...shared,
      locale: "zh-CN"
    }
  };
}

function parseListenPiArgs(argsWithMaybeUndefined: Array<string | undefined>): ListenPiOptions {
  const args = argsWithMaybeUndefined.filter((value): value is string => typeof value === "string");
  const passthroughArgs: string[] = [];
  let piPath: string | undefined;
  let task: string | undefined;
  let piReal = false;
  let piTimeoutMs: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--pi-path") {
      const value = args[index + 1];
      if (!value) throw new Error("--pi-path requires a path.");
      piPath = value;
      index += 1;
      continue;
    }
    if (arg === "--task") {
      const value = args[index + 1];
      if (!value) throw new Error("--task requires text.");
      task = value;
      index += 1;
      continue;
    }
    if (arg === "--pi-real") {
      piReal = true;
      continue;
    }
    if (arg === "--pi-timeout-ms") {
      const value = args[index + 1];
      if (!value) throw new Error("--pi-timeout-ms requires a number.");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--pi-timeout-ms must be a positive number.");
      piTimeoutMs = parsed;
      index += 1;
      continue;
    }
    passthroughArgs.push(arg);
  }

  return {
    task,
    piPath,
    piReal,
    piTimeoutMs,
    ...parseSharedOptions(passthroughArgs),
    locale: "zh-CN"
  };
}

function parseSharedOptions(args: string[]): Omit<RunOfflineOptions, "inputPath" | "locale"> {
  let voice = false;
  let ttsProvider: "mock" | "mimo" = "mock";
  let narrationProvider: "mock" | "openai-compatible" = "mock";
  let saveArtifacts = false;
  let outDir = "output";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--voice") {
      voice = true;
      continue;
    }
    if (arg === "--no-voice") {
      voice = false;
      continue;
    }
    if (arg === "--save-artifacts") {
      saveArtifacts = true;
      continue;
    }
    if (arg === "--tts") {
      const value = args[index + 1];
      if (value !== "mock" && value !== "mimo") {
        throw new Error("--tts must be mock or mimo.");
      }
      ttsProvider = value;
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const value = args[index + 1];
      if (!value) throw new Error("--out requires a directory.");
      outDir = value;
      index += 1;
      continue;
    }
    if (arg === "--narration-provider") {
      const value = args[index + 1];
      if (value !== "mock" && value !== "openai-compatible") {
        throw new Error("--narration-provider must be mock or openai-compatible.");
      }
      narrationProvider = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    voice,
    ttsProvider,
    narrationProvider,
    saveArtifacts,
    outDir
  };
}

async function listenPi(options: ListenPiOptions): Promise<number> {
  if (options.task) {
    await runPiTaskOnce({ ...options, task: options.task });
    return 0;
  }

  const rl = createInterface({ input, output });
  try {
    process.stdout.write("Her-Samantha Pi listener. Type a task, or exit to quit.\n");
    while (true) {
      const answer = await questionOrUndefined(rl, "samantha pi> ");
      if (answer === undefined) break;
      const task = answer.trim();
      if (task.length === 0) continue;
      if (task === "exit" || task === "quit") break;
      await runPiTaskOnce({ ...options, task });
    }
  } finally {
    rl.close();
  }
  return 0;
}

async function questionOrUndefined(
  rl: ReturnType<typeof createInterface>,
  prompt: string
): Promise<string | undefined> {
  try {
    return await rl.question(prompt);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
      return undefined;
    }
    throw error;
  }
}

async function runPiTaskOnce(options: RunPiTaskOptions): Promise<void> {
  const session = createSamanthaSession();
  const result = await session.runPiTask(options);
  process.stdout.write(
    renderTerminalSummary({
      narration: result.narration,
      voice: result.voice,
      artifacts: result.artifacts
    })
  );
}

function helpText(): string {
  return `Her-Samantha\n\nUsage:\n  samantha doctor\n  samantha run offline <file> [--tts mock|mimo] [--voice] [--save-artifacts] [--out output]\n  samantha run <file> [--tts mock|mimo] [--voice] [--save-artifacts]\n  samantha listen pi [--pi-path path] [--pi-real] [--pi-timeout-ms ms] [--task text] [--tts mock|mimo] [--voice] [--save-artifacts]\n\n`;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  });
