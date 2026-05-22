import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentTraceEvent,
  ArtifactWriteResult,
  NarrationResult,
  TaskExecutionResult,
  VoiceOutputResult
} from "../core/types.js";

export async function writeArtifacts(options: {
  enabled: boolean;
  outDir: string;
  runId: string;
  execution: TaskExecutionResult;
  trace: AgentTraceEvent[];
  narration: NarrationResult;
  voice: VoiceOutputResult;
}): Promise<ArtifactWriteResult> {
  if (!options.enabled) {
    return { enabled: false, errors: [] };
  }

  const outputDir = join(options.outDir, options.runId);
  await mkdir(outputDir, { recursive: true });

  const reportJsonPath = join(outputDir, "report.json");
  const reportMarkdownPath = join(outputDir, "report.md");
  const normalizedTracePath = join(outputDir, "trace.normalized.json");

  await writeFile(
    reportJsonPath,
    JSON.stringify(
      {
        runId: options.runId,
        runtime: options.execution.runtime,
        userTask: options.execution.userTask,
        narration: {
          spokenSummary: options.narration.spokenSummary,
          shouldSpeak: options.narration.shouldSpeak,
          voiceStyle: options.narration.voiceStyle,
          riskNote: options.narration.riskNote,
          warnings: options.narration.warnings,
          fallbackUsed: options.narration.fallbackUsed
        },
        textDetail: options.narration.textDetail,
        voice: options.voice,
        artifacts: {
          outputDir,
          reportMarkdownPath,
          reportJsonPath,
          normalizedTracePath,
          audioPath: options.voice.audioPath
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(reportMarkdownPath, buildMarkdownReport(options), "utf8");
  await writeFile(normalizedTracePath, JSON.stringify(options.trace, null, 2), "utf8");

  return {
    enabled: true,
    outputDir,
    reportMarkdownPath,
    reportJsonPath,
    normalizedTracePath,
    audioPath: options.voice.audioPath,
    errors: []
  };
}

function buildMarkdownReport(options: {
  execution: TaskExecutionResult;
  narration: NarrationResult;
  voice: VoiceOutputResult;
}): string {
  const selected = options.narration.textDetail.lettersDemo?.selectedLetter ?? "n/a";
  const reason = options.narration.textDetail.lettersDemo?.reason ?? "n/a";

  return [
    "# Her-Samantha Report",
    "",
    "## Task",
    "",
    options.execution.userTask,
    "",
    "## Spoken Summary",
    "",
    options.narration.spokenSummary,
    "",
    "## Result",
    "",
    `- Selected: ${selected}`,
    `- Reason: ${reason}`,
    "",
    "## Voice",
    "",
    `- Requested: ${options.voice.requested}`,
    `- Success: ${options.voice.success}`,
    `- Audio: ${options.voice.audioPath ?? "n/a"}`,
    "",
    "## Steps",
    "",
    ...options.narration.textDetail.steps.map(
      (step) => `- ${step.turnId}. ${step.type}${step.target ? ` (${step.target})` : ""}: ${step.summary}`
    ),
    ""
  ].join("\n");
}
