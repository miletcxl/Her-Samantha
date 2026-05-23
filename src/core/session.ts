import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifacts } from "../artifacts/writer.js";
import { createFallbackNarration } from "../narration/fallback.js";
import { collectNarrationPolicyWarnings } from "../narration/policy.js";
import { createMockNarration } from "../providers/mockNarration.js";
import { synthesizeMockTts } from "../providers/mockTts.js";
import { hasNarrationEnv, readNarrationConfigFromRegistry, readTtsConfigFromRegistry } from "../providers/config.js";
import { synthesizeMimoTts } from "../providers/mimoTts.js";
import { createOpenAICompatibleNarration } from "../providers/openaiCompatibleNarration.js";
import { createOfflineExecutionResult, loadOfflineTraceFixture } from "../runtimes/offline.js";
import { PiRuntimeAdapter } from "../runtimes/pi.js";
import { EventBus } from "./events.js";
import type {
  NarrationInput,
  RunOfflineOptions,
  RunOfflineResult,
  RunPiTaskOptions,
  RunPiTaskResult,
  SamanthaEvent,
  SamanthaSession,
  SamanthaState,
  TaskExecutionResult,
  VoiceOutputResult
} from "./types.js";

export function createSamanthaSession(): SamanthaSession {
  const bus = new EventBus<SamanthaEvent>();
  let state = createInitialState();
  let activeCancel: (() => Promise<void>) | undefined;

  function emit(event: SamanthaEvent): void {
    state = reduceState(state, event);
    bus.emit(event);
  }

  return {
    subscribe: (listener) => bus.subscribe(listener),
    getState: () => state,
    cancel: async () => {
      if (activeCancel) {
        await activeCancel();
      }
    },
    runOffline: async (options): Promise<RunOfflineResult> => {
      try {
        state = createInitialState();
        emit({ type: "runtime:started", runtime: "offline" });
        emit({ type: "runtime:status", phase: "loading", message: "Loading offline trace..." });

        const fixture = await loadOfflineTraceFixture(options.inputPath);
        const execution = createOfflineExecutionResult(fixture);
        const completed = await completeExecution(execution, {
          voice: options.voice,
          ttsProvider: options.ttsProvider,
          narrationProvider: options.narrationProvider ?? (hasNarrationEnv() ? "openai-compatible" : "mock"),
          saveArtifacts: options.saveArtifacts,
          outDir: options.outDir,
          locale: options.locale ?? "zh-CN"
        });

        return {
          fixture,
          trace: execution.trace,
          narration: completed.narration,
          voice: completed.voice,
          artifacts: completed.artifacts,
          state: completed.state
        } satisfies RunOfflineResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state = { ...state, taskStatus: "failed", errors: [...state.errors, message] };
        emit({ type: "task:failed", error: message, state });
        throw error;
      }
    },
    runPiTask: async (options: RunPiTaskOptions): Promise<RunPiTaskResult> => {
      try {
        state = createInitialState("pi");
        emit({ type: "runtime:started", runtime: "pi" });
        const adapter = new PiRuntimeAdapter({
          piPath: options.piPath,
          realExecution: options.piReal,
          timeoutMs: options.piTimeoutMs,
          sessionDir: options.piSessionDir,
          session: options.piSession,
          continueSession: options.piContinue,
          resume: options.piResume,
          fork: options.piFork
        });
        activeCancel = () => adapter.cancel();
        const unsubscribe = adapter.subscribe((event) => {
          if (event.type === "status") {
            emit({ type: "runtime:status", phase: "pi", message: event.message });
          }
          if (event.type === "permission_prompt") {
            emit({ type: "runtime:permission_prompt", message: event.message, options: event.options });
          }
        });

        try {
          await adapter.start();
          const execution = await adapter.sendTask(options.task);
          const completed = await completeExecution(execution, {
            voice: options.voice,
            ttsProvider: options.ttsProvider,
            narrationProvider: options.narrationProvider ?? (hasNarrationEnv() ? "openai-compatible" : "mock"),
            saveArtifacts: options.saveArtifacts,
            outDir: options.outDir,
            locale: options.locale ?? "zh-CN"
          });
          return { execution, ...completed };
        } finally {
          unsubscribe();
          await adapter.dispose();
          activeCancel = undefined;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state = { ...state, taskStatus: "failed", errors: [...state.errors, message] };
        emit({ type: "task:failed", error: message, state });
        throw error;
      }
    }
  };

  async function completeExecution(
    execution: TaskExecutionResult,
    options: {
      voice: boolean;
      ttsProvider: RunOfflineOptions["ttsProvider"];
      narrationProvider: NonNullable<RunOfflineOptions["narrationProvider"]>;
      saveArtifacts: boolean;
      outDir: string;
      locale: string;
    }
  ): Promise<Omit<RunPiTaskResult, "execution">> {
    state = { ...state, runtime: execution.runtime, currentTask: execution.userTask, taskStatus: "running" };
    emit({ type: "trace:normalized", trace: execution.trace, warnings: execution.warnings });

    emit({ type: "narration:started" });
    const narrationInput: NarrationInput = {
      userTask: execution.userTask,
      runtime: execution.runtime,
      locale: options.locale,
      voiceStyle: "warm_assistant",
      trace: execution.trace,
      finalResult: execution.finalResult,
      warnings: execution.warnings
    };
    const narration = await createNarration(narrationInput, options.narrationProvider);
    emit({ type: "narration:completed", result: narration });

    const runId = createRunId();
    const voice = await runVoiceIfNeeded(options, narration.spokenSummary, runId, emit);
    emit({ type: "voice:completed", result: voice });

    const artifacts = await writeArtifacts({
      enabled: options.saveArtifacts,
      outDir: options.outDir,
      runId,
      execution,
      trace: execution.trace,
      narration,
      voice
    });
    emit({ type: "artifact:written", result: artifacts });

    const resultState = {
      ...state,
      taskStatus: "completed" as const,
      finalAnswerPreview: execution.finalResult.finalAnswer?.slice(0, 120),
      finalAnswerFull: execution.finalResult.finalAnswer
    };
    state = resultState;
    emit({ type: "task:completed", state });

    return { narration, voice, artifacts, state };
  }
}

function createInitialState(runtime: "offline" | "pi" = "offline"): SamanthaState {
  return {
    runtime,
    taskStatus: "idle",
    errors: [],
    warnings: []
  };
}

async function createNarration(
  input: Parameters<typeof createMockNarration>[0],
  provider: "mock" | "openai-compatible"
) {
  try {
    const narration =
      provider === "mock"
        ? createMockNarration(input)
        : await createOpenAICompatibleNarration(input, await readNarrationConfigFromRegistry());
    return {
      ...narration,
      warnings: [...narration.warnings, ...collectNarrationPolicyWarnings(narration.spokenSummary)]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFallbackNarration(input, message);
  }
}

function reduceState(state: SamanthaState, event: SamanthaEvent): SamanthaState {
  switch (event.type) {
    case "runtime:started":
      return { ...state, runtime: event.runtime, taskStatus: "running" };
    case "runtime:status":
      return { ...state, progressMessage: event.message };
    case "runtime:permission_prompt":
      return { ...state, progressMessage: event.message };
    case "trace:normalized":
      return { ...state, taskStatus: "normalizing", warnings: [...state.warnings, ...event.warnings] };
    case "narration:started":
      return { ...state, taskStatus: "narrating" };
    case "narration:completed":
      return {
        ...state,
        spokenSummary: event.result.spokenSummary,
        textDetail: event.result.textDetail,
        riskNote: event.result.riskNote,
        warnings: [...state.warnings, ...event.result.warnings]
      };
    case "voice:started":
      return { ...state, taskStatus: "speaking" };
    case "voice:completed":
      return { ...state, voice: event.result };
    case "artifact:written":
      return { ...state, artifacts: event.result };
    case "task:completed":
      return event.state;
    case "task:failed":
      return event.state;
  }
}

async function runVoiceIfNeeded(
  options: {
    voice: boolean;
    ttsProvider: "mock" | "mimo";
    saveArtifacts: boolean;
    outDir: string;
  },
  spokenSummary: string,
  runId: string,
  emit: (event: SamanthaEvent) => void
): Promise<VoiceOutputResult> {
  if (!options.voice) {
    return {
      requested: false,
      skipped: true,
      success: true,
      provider: options.ttsProvider,
      temporary: false,
      played: false
    };
  }

  emit({ type: "voice:started", provider: options.ttsProvider });
  const outputFormat = options.ttsProvider === "mimo" ? readMimoOutputFormat() : "wav";
  const audioPath = options.saveArtifacts
    ? join(options.outDir, runId, `samantha_summary.${outputFormat}`)
    : join(await mkdtemp(join(tmpdir(), "her-samantha-")), `samantha_summary.${outputFormat}`);

const voice =
    options.ttsProvider === "mock"
      ? await synthesizeMockTts({
          spokenSummary,
          outputPath: audioPath,
          temporary: !options.saveArtifacts
        })
      : await synthesizeMimoTtsWithFallback(spokenSummary, audioPath, !options.saveArtifacts, 60_000);

  if (!options.saveArtifacts && voice.audioPath) {
    await rm(voice.audioPath, { force: true });
  }

  return options.saveArtifacts ? voice : { ...voice, audioPath: undefined };
}

async function synthesizeMimoTtsWithFallback(
  spokenSummary: string,
  outputPath: string,
  temporary: boolean,
  timeoutMs: number
): Promise<VoiceOutputResult> {
  try {
    return await withTimeout(
      synthesizeMimoTts({
        spokenSummary,
        outputPath,
        temporary,
        config: await readTtsConfigFromRegistry()
      }),
      timeoutMs,
      `Mimo TTS timed out after ${timeoutMs}ms.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      requested: true,
      skipped: false,
      success: false,
      provider: "mimo",
      temporary,
      played: false,
      error: message
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readMimoOutputFormat(): "mp3" | "wav" {
  const configured = process.env.SAMANTHA_TTS_OUTPUT_FORMAT ?? "mp3";
  return configured === "wav" ? "wav" : "mp3";
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${timestamp}-${suffix}`;
}
