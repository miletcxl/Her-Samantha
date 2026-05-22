import { access } from "node:fs/promises";
import { spawn, type SpawnOptions } from "node:child_process";
import { delimiter, isAbsolute, join } from "node:path";
import { EventBus } from "../core/events.js";
import type { AgentRuntimeAdapter, AgentTraceEvent, RuntimeAdapterEvent, TaskExecutionResult } from "../core/types.js";

export interface PiRuntimeAdapterOptions {
  piPath?: string;
  realExecution?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface PiJsonExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly name = "pi" as const;
  private readonly bus = new EventBus<RuntimeAdapterEvent>();
  private readonly env: NodeJS.ProcessEnv;
  private readonly configuredPiPath?: string;
  private readonly realExecution: boolean;
  private readonly timeoutMs: number;
  private resolvedPiPath?: string;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.configuredPiPath = options.piPath;
    this.realExecution = options.realExecution ?? false;
    this.timeoutMs = options.timeoutMs ?? readTimeoutMs(options.env ?? process.env);
    this.env = options.env ?? process.env;
  }

  subscribe(listener: (event: RuntimeAdapterEvent) => void): () => void {
    return this.bus.subscribe(listener);
  }

  async start(): Promise<void> {
    this.resolvedPiPath = await resolvePiPath({
      cliPiPath: this.configuredPiPath,
      env: this.env
    });
    this.bus.emit({ type: "status", message: `Resolved Pi executable: ${this.resolvedPiPath}` });
  }

  async sendTask(text: string): Promise<TaskExecutionResult> {
    if (this.realExecution) {
      const piPath = this.resolvedPiPath;
      if (!piPath) {
        throw new Error("PiRuntimeAdapter.start() must resolve piPath before sendTask().");
      }
      this.bus.emit({ type: "status", message: "Starting Pi JSON mode..." });
      const result = await executePiJsonPrint({
        piPath,
        task: text,
        timeoutMs: this.timeoutMs,
        env: this.env
      });
      if (result.timedOut) {
        throw new Error(
          `Pi JSON mode timed out after ${this.timeoutMs}ms. Real Pi model calls can take 60-120 seconds; retry with --pi-timeout-ms 120000 or 180000.`
        );
      }
      if (result.exitCode !== 0) {
        throw new Error(`Pi exited with code ${result.exitCode}: ${result.stderr.slice(0, 1000)}`);
      }
      return normalizePiJsonLines(text, result.stdout);
    }

    const message =
      "PiRuntimeAdapter skeleton is ready, but real Pi RPC/event-stream execution is not implemented yet.";
    const piPath = this.resolvedPiPath ?? "unresolved";
    return {
      userTask: text,
      runtime: "pi",
      warnings: [message],
      trace: [
        {
          turnId: 1,
          type: "task_start",
          sourceRuntime: "pi",
          sourceEventId: "pi-skeleton-1",
          publicMessage: `Received task for Pi adapter: ${text}`,
          resultSummary: `Pi path: ${piPath}`,
          importance: "medium",
          status: "ok"
        },
        {
          turnId: 2,
          type: "error",
          sourceRuntime: "pi",
          sourceEventId: "pi-skeleton-2",
          publicMessage: message,
          resultSummary: "Waiting for Pi public RPC, JSON event stream, or SDK session integration.",
          importance: "high",
          status: "warning",
          metadata: {
            piPath
          }
        }
      ],
      finalResult: {
        status: "partial",
        finalAnswer: message,
        reason: "Pi adapter is intentionally a boundary skeleton in this MVP step.",
        data: {
          piPath
        }
      }
    };
  }

  async cancel(): Promise<void> {
    this.bus.emit({ type: "status", message: "Pi task cancellation requested." });
  }

  async dispose(): Promise<void> {
    this.bus.emit({ type: "status", message: "Pi runtime adapter disposed." });
  }
}

export async function executePiJsonPrint(options: {
  piPath: string;
  task: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<PiJsonExecutionResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const env = createPiProcessEnv(options.env ?? process.env);
    const child = spawn(options.piPath, buildPiJsonPrintArgs(options.task, env), buildPiSpawnOptions(env));
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    if (!child.stdout || !child.stderr) {
      clearTimeout(timeout);
      reject(new Error("Pi process stdout/stderr streams were not available."));
      return;
    }

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
      if (timedOut) {
        resolve({
          stdout,
          stderr,
          exitCode,
          timedOut: true
        });
        return;
      }
      resolve({ stdout, stderr, exitCode, timedOut: false });
    });
  });
}

export function buildPiJsonPrintArgs(task: string, env: NodeJS.ProcessEnv): string[] {
  const args = ["--mode", "json", "-p"];
  if (env.SAMANTHA_PI_PROVIDER) {
    args.push("--provider", env.SAMANTHA_PI_PROVIDER);
  }
  if (env.SAMANTHA_PI_MODEL) {
    args.push("--model", env.SAMANTHA_PI_MODEL);
  }
  args.push(task);
  return args;
}

export function buildPiSpawnOptions(env: NodeJS.ProcessEnv): SpawnOptions {
  return {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  };
}

export function createPiProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env };
  if (!childEnv.XIAOMI_TOKEN_PLAN_CN_API_KEY && childEnv.MIMO_API_KEY) {
    childEnv.XIAOMI_TOKEN_PLAN_CN_API_KEY = childEnv.MIMO_API_KEY;
  }
  return childEnv;
}

function readTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.SAMANTHA_PI_TIMEOUT_MS;
  if (!raw) return 120_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

export function normalizePiJsonLines(userTask: string, stdout: string): TaskExecutionResult {
  const events = parsePiJsonLines(stdout);
  const trace: AgentTraceEvent[] = [];
  let finalAnswer = "";
  let status: "completed" | "failed" | "aborted" | "partial" = "partial";
  let turnId = 1;

  for (const event of events) {
    const normalized = normalizePiJsonEvent(event, turnId);
    if (normalized) {
      trace.push(normalized);
      turnId += 1;
    }

    if (isRecord(event) && event.type === "message_end" && isRecord(event.message)) {
      const message = event.message;
      if (message.role === "assistant") {
        const text = extractPublicText(message.content);
        if (text) finalAnswer = text;
        if (message.stopReason === "aborted") status = "aborted";
        else if (message.stopReason === "error") status = "failed";
        else status = "completed";
      }
    }
    if (isRecord(event) && event.type === "agent_end" && status === "partial") {
      status = "completed";
    }
  }

  return {
    userTask,
    runtime: "pi",
    trace:
      trace.length > 0
        ? trace
        : [
            {
              turnId: 1,
              type: "final",
              sourceRuntime: "pi",
              sourceEventId: "pi-json-empty",
              publicMessage: finalAnswer || "Pi completed without public JSON events.",
              resultSummary: finalAnswer || undefined,
              importance: "medium",
              status: status === "failed" ? "error" : "ok"
            }
          ],
    finalResult: {
      status,
      finalAnswer: finalAnswer || undefined
    },
    warnings: []
  };
}

export function parsePiJsonLines(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "parse_error", raw: line.slice(0, 500) };
      }
    });
}

function normalizePiJsonEvent(event: unknown, turnId: number): AgentTraceEvent | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;

  if (event.type === "message_end" && isRecord(event.message)) {
    const message = event.message;
    if (message.role === "user") {
      const text = extractPublicText(message.content);
      return {
        turnId,
        type: "task_start",
        sourceRuntime: "pi",
        sourceEventId: stringField(event, "id") ?? `pi-json-${turnId}`,
        publicMessage: text || "User message",
        resultSummary: text || undefined,
        importance: "medium",
        status: "ok"
      };
    }
    if (message.role === "assistant") {
      const text = extractPublicText(message.content);
      if (!text) return undefined;
      return {
        turnId,
        type: "final",
        sourceRuntime: "pi",
        sourceEventId: stringField(event, "id") ?? `pi-json-${turnId}`,
        publicMessage: text,
        resultSummary: text,
        importance: "high",
        status: message.stopReason === "error" ? "error" : "ok"
      };
    }
  }

  if (event.type === "tool_execution_start") {
    const toolName = stringField(event, "toolName") ?? "tool";
    return {
      turnId,
      type: toolName === "read" ? "read_file" : "analyze",
      sourceRuntime: "pi",
      sourceEventId: stringField(event, "toolCallId") ?? `pi-json-${turnId}`,
      target: toolName,
      publicMessage: `Pi started tool: ${toolName}`,
      resultSummary: summarizeToolArgs(event.args),
      importance: "medium",
      status: "ok"
    };
  }

  if (event.type === "tool_execution_end") {
    const toolName = stringField(event, "toolName") ?? "tool";
    const isError = Boolean(event.isError);
    return {
      turnId,
      type: isError ? "error" : "analyze",
      sourceRuntime: "pi",
      sourceEventId: stringField(event, "toolCallId") ?? `pi-json-${turnId}`,
      target: toolName,
      publicMessage: `Pi finished tool: ${toolName}`,
      resultSummary: summarizeToolResult(event.result),
      importance: isError ? "high" : "medium",
      status: isError ? "error" : "ok"
    };
  }

  if (event.type === "parse_error") {
    return {
      turnId,
      type: "error",
      sourceRuntime: "pi",
      sourceEventId: `pi-json-${turnId}`,
      publicMessage: "Pi emitted a non-JSON line.",
      resultSummary: stringField(event, "raw"),
      importance: "low",
      status: "warning"
    };
  }

  return undefined;
}

function extractPublicText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function summarizeToolArgs(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  const path = stringField(args, "path");
  const command = stringField(args, "command");
  if (path) return `path: ${path}`;
  if (command) return `command: ${command.slice(0, 160)}`;
  return undefined;
}

function summarizeToolResult(result: unknown): string | undefined {
  const text = extractPublicTextFromUnknown(result);
  return text ? text.slice(0, 300) : undefined;
}

function extractPublicTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  if (Array.isArray(value.content)) return extractPublicText(value.content);
  if (typeof value.text === "string") return value.text.trim();
  return "";
}

function stringField(value: unknown, field: string): string | undefined {
  return isRecord(value) && typeof value[field] === "string" ? value[field] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function resolvePiPath(options: {
  cliPiPath?: string;
  env?: NodeJS.ProcessEnv;
  pathValue?: string;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const candidates = [
    options.cliPiPath,
    env.SAMANTHA_PI_PATH,
    ...(await findOnPath(["pi", "pi.exe"], options.pathValue ?? env.PATH ?? ""))
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    if (await canAccess(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to find Pi executable. Use --pi-path, SAMANTHA_PI_PATH, or add pi/pi.exe to PATH.");
}

async function findOnPath(names: string[], pathValue: string): Promise<string[]> {
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const candidates: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      candidates.push(isAbsolute(name) ? name : join(dir, name));
    }
  }
  return candidates;
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
