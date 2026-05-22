import { readFile } from "node:fs/promises";
import type { AgentTraceEvent, OfflineTraceFixture, TaskExecutionResult } from "../core/types.js";

export async function loadOfflineTraceFixture(path: string): Promise<OfflineTraceFixture> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertOfflineTraceFixture(parsed);
  return parsed;
}

export function normalizeOfflineTrace(fixture: OfflineTraceFixture): AgentTraceEvent[] {
  return fixture.events.map((event, index) => ({
    turnId: event.turnId,
    type: event.type,
    sourceRuntime: "offline",
    sourceEventId: `offline-${index + 1}`,
    target: event.target,
    publicMessage: event.publicMessage,
    resultSummary: event.resultSummary,
    importance: event.importance,
    status: event.status ?? "ok",
    metadata: event.metadata
  }));
}

export function createOfflineExecutionResult(fixture: OfflineTraceFixture): TaskExecutionResult {
  return {
    userTask: fixture.userTask,
    runtime: "offline",
    trace: normalizeOfflineTrace(fixture),
    finalResult: fixture.finalResult,
    warnings: []
  };
}

function assertOfflineTraceFixture(value: unknown): asserts value is OfflineTraceFixture {
  if (!isObject(value)) {
    throw new Error("Offline trace fixture must be a JSON object.");
  }
  if (value.kind !== "recorded_trace") {
    throw new Error("Offline trace fixture kind must be \"recorded_trace\".");
  }
  if (value.runtime !== "offline") {
    throw new Error("Offline trace fixture runtime must be \"offline\".");
  }
  if (typeof value.userTask !== "string" || value.userTask.length === 0) {
    throw new Error("Offline trace fixture must include userTask.");
  }
  if (!Array.isArray(value.events)) {
    throw new Error("Offline trace fixture must include events array.");
  }
  if (!isObject(value.finalResult)) {
    throw new Error("Offline trace fixture must include finalResult.");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
