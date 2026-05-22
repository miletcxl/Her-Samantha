export type RuntimeName = "offline" | "pi";

export type TraceEventType =
  | "task_start"
  | "read_file"
  | "analyze"
  | "compare"
  | "select"
  | "final"
  | "error"
  | "aborted";

export interface OfflineTraceEvent {
  turnId: number;
  type: TraceEventType;
  target?: string;
  publicMessage: string;
  resultSummary?: string;
  importance: "low" | "medium" | "high";
  status?: "ok" | "warning" | "error";
  metadata?: Record<string, unknown>;
}

export interface OfflineTraceFixture {
  kind: "recorded_trace";
  userTask: string;
  runtime: "offline";
  events: OfflineTraceEvent[];
  finalResult: {
    status: "completed" | "failed" | "aborted" | "partial";
    finalAnswer?: string;
    selectedItem?: string;
    reason?: string;
    data?: Record<string, unknown>;
  };
}

export interface AgentTraceEvent {
  turnId: number;
  type: TraceEventType;
  sourceRuntime: RuntimeName;
  sourceEventId?: string;
  target?: string;
  publicMessage: string;
  resultSummary?: string;
  importance: "low" | "medium" | "high";
  status: "ok" | "warning" | "error";
  metadata?: Record<string, unknown>;
}

export interface NarrationInput {
  userTask: string;
  runtime: RuntimeName;
  locale: string;
  voiceStyle: "warm_assistant" | "neutral" | "concise";
  trace: AgentTraceEvent[];
  finalResult?: OfflineTraceFixture["finalResult"];
  warnings: string[];
}

export interface TaskFinalResult {
  status: "completed" | "failed" | "aborted" | "partial";
  finalAnswer?: string;
  selectedItem?: string;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface TaskExecutionResult {
  userTask: string;
  runtime: RuntimeName;
  trace: AgentTraceEvent[];
  finalResult: TaskFinalResult;
  warnings: string[];
}

export type RuntimeAdapterEvent =
  | { type: "status"; message: string }
  | { type: "trace"; event: AgentTraceEvent }
  | { type: "permission_prompt"; message: string; options?: string[] };

export interface AgentRuntimeAdapter {
  name: RuntimeName;
  start(): Promise<void>;
  sendTask(text: string): Promise<TaskExecutionResult>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  subscribe(listener: (event: RuntimeAdapterEvent) => void): () => void;
}

export interface NarrationResult {
  spokenSummary: string;
  textDetail: {
    status: "completed" | "failed" | "aborted" | "partial";
    userTask: string;
    highLevelSummary: string;
    steps: Array<{
      turnId: number;
      type: TraceEventType;
      target?: string;
      summary: string;
      status: "ok" | "warning" | "error";
    }>;
    finalResult?: Record<string, unknown>;
    errors: Array<{
      message: string;
      source?: string;
      recoverable: boolean;
    }>;
    lettersDemo?: {
      selectedLetter?: string;
      reason?: string;
      letterSummaries?: Array<{
        file: string;
        theme: string;
        emotion: string;
        highlight: string;
      }>;
    };
  };
  shouldSpeak: boolean;
  voiceStyle: "warm_assistant" | "neutral" | "concise";
  riskNote?: string | null;
  warnings: string[];
  fallbackUsed: boolean;
}

export interface VoiceOutputResult {
  requested: boolean;
  skipped: boolean;
  success: boolean;
  provider: "mock" | "mimo";
  audioPath?: string;
  temporary: boolean;
  played: boolean;
  durationMs?: number;
  error?: string;
}

export interface ArtifactWriteResult {
  enabled: boolean;
  outputDir?: string;
  reportMarkdownPath?: string;
  reportJsonPath?: string;
  normalizedTracePath?: string;
  audioPath?: string;
  errors: string[];
}

export interface SamanthaState {
  runtime: RuntimeName;
  taskStatus:
    | "idle"
    | "running"
    | "normalizing"
    | "narrating"
    | "speaking"
    | "completed"
    | "failed";
  currentTask?: string;
  progressMessage?: string;
  spokenSummary?: string;
  textDetail?: NarrationResult["textDetail"];
  riskNote?: string | null;
  voice?: VoiceOutputResult;
  artifacts?: ArtifactWriteResult;
  finalAnswerPreview?: string;
  finalAnswerFull?: string;
  errors: string[];
  warnings: string[];
}

export type SamanthaEvent =
  | { type: "runtime:started"; runtime: RuntimeName }
  | { type: "runtime:status"; message: string; phase: string }
  | { type: "runtime:permission_prompt"; message: string; options?: string[] }
  | { type: "trace:normalized"; trace: AgentTraceEvent[]; warnings: string[] }
  | { type: "narration:started" }
  | { type: "narration:completed"; result: NarrationResult }
  | { type: "voice:started"; provider: "mock" | "mimo" }
  | { type: "voice:completed"; result: VoiceOutputResult }
  | { type: "artifact:written"; result: ArtifactWriteResult }
  | { type: "task:completed"; state: SamanthaState }
  | { type: "task:failed"; error: string; state: SamanthaState };

export interface SamanthaCliOptions {
  command: "run";
  runtime: "offline";
  input: string;
  voice: boolean;
  ttsProvider: "mock" | "mimo";
  narrationProvider: "mock" | "openai-compatible";
  saveArtifacts: boolean;
  outDir: string;
  locale: string;
}

export interface RunOfflineOptions {
  inputPath: string;
  voice: boolean;
  ttsProvider: "mock" | "mimo";
  narrationProvider?: "mock" | "openai-compatible";
  saveArtifacts: boolean;
  outDir: string;
  locale?: string;
}

export interface RunOfflineResult {
  fixture: OfflineTraceFixture;
  trace: AgentTraceEvent[];
  narration: NarrationResult;
  voice: VoiceOutputResult;
  artifacts: ArtifactWriteResult;
  state: SamanthaState;
}

export interface RunPiTaskOptions {
  task: string;
  piPath?: string;
  piReal?: boolean;
  piTimeoutMs?: number;
  voice: boolean;
  ttsProvider: "mock" | "mimo";
  narrationProvider?: "mock" | "openai-compatible";
  saveArtifacts: boolean;
  outDir: string;
  locale?: string;
}

export interface RunPiTaskResult {
  execution: TaskExecutionResult;
  narration: NarrationResult;
  voice: VoiceOutputResult;
  artifacts: ArtifactWriteResult;
  state: SamanthaState;
}

export interface SamanthaSession {
  runOffline(options: RunOfflineOptions): Promise<RunOfflineResult>;
  runPiTask(options: RunPiTaskOptions): Promise<RunPiTaskResult>;
  subscribe(listener: (event: SamanthaEvent) => void): () => void;
  getState(): SamanthaState;
}
