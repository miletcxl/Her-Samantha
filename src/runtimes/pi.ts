import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { delimiter, isAbsolute, join } from "node:path";
import { EventBus } from "../core/events.js";
import type {
  AgentRuntimeAdapter,
  AgentTraceEvent,
  RuntimeAdapterEvent,
  RuntimeCapabilities,
  TaskExecutionResult
} from "../core/types.js";

export interface PiRuntimeAdapterOptions {
  piPath?: string;
  realExecution?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  model?: string;
  sessionDir?: string;
  session?: string;
  continueSession?: boolean;
  resume?: boolean;
  fork?: string;
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
  private readonly sessionOptions: PiSessionOptions;
  private resolvedPiPath?: string;
  private rpc?: PiRpcClient;

  private readonly model?: string;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.configuredPiPath = options.piPath;
    this.realExecution = options.realExecution ?? false;
    this.timeoutMs = options.timeoutMs ?? readTimeoutMs(options.env ?? process.env);
    this.env = options.env ?? process.env;
    this.model = options.model;
    this.sessionOptions = {
      sessionDir: options.sessionDir,
      session: options.session,
      continueSession: options.continueSession,
      resume: options.resume,
      fork: options.fork
    };
  }

  subscribe(listener: (event: RuntimeAdapterEvent) => void): () => void {
    return this.bus.subscribe(listener);
  }

  getCapabilities(): RuntimeCapabilities {
    return {
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
    };
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
      this.bus.emit({ type: "status", message: "Starting Pi RPC mode..." });
      this.rpc ??= startPiRpc({
        piPath,
        env: this.env,
        model: this.model,
        sessionOptions: this.sessionOptions,
        onEvent: (event) => this.handleRpcEvent(event)
      });
      try {
        return await this.rpc.prompt(text, this.timeoutMs);
      } catch (error) {
        if (isPiRpcPromptTimeout(error)) {
          this.rpc.dispose();
          this.rpc = undefined;
        }
        throw error;
      }
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
    if (this.rpc) {
      await this.rpc.abort();
    }
    this.bus.emit({ type: "status", message: "Pi task cancellation requested." });
  }

  async dispose(): Promise<void> {
    this.rpc?.dispose();
    this.rpc = undefined;
    this.bus.emit({ type: "status", message: "Pi runtime adapter disposed." });
  }

  private handleRpcEvent(event: unknown): void {
    this.bus.emit({ type: "raw", sourceRuntime: "pi", event });
    const normalized = normalizePiJsonEvent(event, -1);
    if (normalized) {
      this.bus.emit({ type: "trace", event: normalized });
    }
    if (isRecord(event) && event.type === "extension_ui_request") {
      const message = stringField(event, "message") ?? stringField(event, "title") ?? "Pi requested input.";
      const options = Array.isArray(event.options)
        ? event.options.filter((value): value is string => typeof value === "string")
        : undefined;
      this.bus.emit({ type: "permission_prompt", message, options });
    }
  }
}

export function isPiRpcPromptTimeout(error: unknown): boolean {
  return error instanceof Error && /^Pi RPC prompt timed out after \d+ms\./.test(error.message);
}

export interface PiRpcStartOptions {
  piPath: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  sessionOptions?: PiSessionOptions;
  onEvent?: (event: unknown) => void;
}

export interface PiSessionOptions {
  sessionDir?: string;
  session?: string;
  continueSession?: boolean;
  resume?: boolean;
  fork?: string;
}

export interface PiRpcClient {
  prompt(message: string, timeoutMs: number): Promise<TaskExecutionResult>;
  getState(timeoutMs?: number): Promise<unknown>;
  abort(): Promise<void>;
  sendUnsupportedConfigChange(kind: "model" | "provider", value: string): Promise<never>;
  dispose(): void;
}

interface PendingRpcResponse {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class SpawnedPiRpcClient implements PiRpcClient {
  private readonly pending = new Map<string, PendingRpcResponse>();
  private readonly events: unknown[] = [];
  private readonly process: ChildProcess;
  private sequence = 0;
  private activePrompt?: {
    userTask: string;
    resolve: (value: TaskExecutionResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  };

  constructor(process: ChildProcess, private readonly onEvent?: (event: unknown) => void) {
    if (!process.stdin || !process.stdout || !process.stderr) {
      throw new Error("Pi RPC process stdin/stdout/stderr streams were not available.");
    }
    this.process = process;
    attachJsonlReader(process.stdout, (event) => this.handleStdoutEvent(event));
    process.stderr.setEncoding("utf8");
    process.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
    process.on("exit", (code) => {
      if (code !== 0 && this.activePrompt) {
        this.activePrompt.reject(new Error(`Pi RPC process exited with code ${code}.`));
      }
    });
  }

  async prompt(message: string, timeoutMs: number): Promise<TaskExecutionResult> {
    if (this.activePrompt) {
      throw new Error("Pi RPC prompt is already running.");
    }
    this.events.length = 0;
    await this.sendCommand("prompt", { message }, timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.activePrompt = undefined;
        reject(
          new Error(
            `Pi RPC prompt timed out after ${timeoutMs}ms. Real Pi model calls can take 60-120 seconds; retry with --pi-timeout-ms 120000 or 180000.`
          )
        );
      }, timeoutMs);
      this.activePrompt = { userTask: message, resolve, reject, timer };
    });
  }

  async getState(timeoutMs = 10_000): Promise<unknown> {
    return await this.sendCommand("get_state", {}, timeoutMs);
  }

  async abort(): Promise<void> {
    await this.sendCommand("abort", {}, 10_000);
  }

  async sendUnsupportedConfigChange(kind: "model" | "provider", value: string): Promise<never> {
    await Promise.resolve();
    throw new Error(`Pi RPC does not expose runtime ${kind} switching in this adapter yet: ${value}`);
  }

  dispose(): void {
    this.failAll(new Error("Pi RPC client disposed."));
    this.process.kill();
  }

  private sendCommand(command: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = `samantha-${++this.sequence}`;
    const payload = JSON.stringify({ id, type: command, ...body });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC command ${command} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { command, resolve, reject, timer });
      const stdin = this.process.stdin;
      if (!stdin) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Pi RPC process stdin stream was not available."));
        return;
      }
      stdin.write(`${payload}\n`, "utf8");
    });
  }

  private handleStdoutEvent(event: unknown): void {
    this.onEvent?.(event);
    if (isRecord(event) && event.type === "response" && typeof event.id === "string") {
      const pending = this.pending.get(event.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(event.id);
        if (event.success === false) {
          pending.reject(new Error(stringField(event, "error") ?? `Pi RPC command ${pending.command} failed.`));
        } else {
          pending.resolve(event);
        }
      }
      return;
    }

    this.events.push(event);
    if (isRecord(event) && event.type === "agent_end" && this.activePrompt) {
      clearTimeout(this.activePrompt.timer);
      const prompt = this.activePrompt;
      this.activePrompt = undefined;
      prompt.resolve(normalizePiJsonEvents(prompt.userTask, this.events));
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.activePrompt) {
      clearTimeout(this.activePrompt.timer);
      this.activePrompt.reject(error);
      this.activePrompt = undefined;
    }
  }
}

export function startPiRpc(options: PiRpcStartOptions): PiRpcClient {
  const env = createPiProcessEnv(options.env ?? process.env);
  const child = spawn(options.piPath, buildPiRpcArgs(env, options.model, options.sessionOptions), buildPiRpcSpawnOptions(env));
  return new SpawnedPiRpcClient(child, options.onEvent);
}

export function buildPiRpcArgs(env: NodeJS.ProcessEnv, model?: string, sessionOptions: PiSessionOptions = {}): string[] {
  const args = ["--mode", "rpc"];
  if (env.SAMANTHA_PI_PROVIDER) {
    args.push("--provider", env.SAMANTHA_PI_PROVIDER);
  }
  const effectiveModel = model ?? env.SAMANTHA_PI_MODEL;
  if (effectiveModel) {
    args.push("--model", effectiveModel);
  }
  appendPiSystemPrompt(args);
  appendPiSessionArgs(args, sessionOptions);
  return args;
}

const SAMANTHA_PI_SYSTEM_PROMPT_PATH = ".samantha/pi-system-prompt.md";

function appendPiSystemPrompt(args: string[]): void {
  if (existsSync(SAMANTHA_PI_SYSTEM_PROMPT_PATH)) {
    args.push("--append-system-prompt", SAMANTHA_PI_SYSTEM_PROMPT_PATH);
  }
}

function appendPiSessionArgs(args: string[], options: PiSessionOptions): void {
  if (options.sessionDir) args.push("--session-dir", options.sessionDir);
  if (options.session) args.push("--session", options.session);
  if (options.continueSession) args.push("--continue");
  if (options.resume) args.push("--resume");
  if (options.fork) args.push("--fork", options.fork);
}

export function buildPiRpcSpawnOptions(env: NodeJS.ProcessEnv): SpawnOptions {
  return {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  };
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
  return normalizePiJsonEvents(userTask, parsePiJsonLines(stdout));
}

export function normalizePiJsonEvents(userTask: string, events: unknown[]): TaskExecutionResult {
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

export function attachJsonlReader(stream: NodeJS.ReadableStream, onEvent: (event: unknown) => void): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.trim().length > 0) {
        onEvent(parseJsonLine(line));
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  stream.on("end", () => {
    const tail = buffer + decoder.end();
    if (tail.trim().length > 0) {
      onEvent(parseJsonLine(tail));
    }
  });
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return { type: "parse_error", raw: line.slice(0, 500) };
  }
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
