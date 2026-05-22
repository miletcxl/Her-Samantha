import type { ArtifactWriteResult, NarrationResult, VoiceOutputResult } from "../core/types.js";

export function renderTerminalSummary(options: {
  narration: NarrationResult;
  voice: VoiceOutputResult;
  artifacts: ArtifactWriteResult;
}): string {
  const lines = [
    "Done.",
    "",
    "Spoken summary:",
    options.narration.spokenSummary,
    "",
    "Voice:",
    formatVoice(options.voice)
  ];

  if (options.narration.warnings.length > 0) {
    lines.push("", "Warnings:", ...options.narration.warnings.map((warning) => `- ${warning}`));
  }

  if (options.artifacts.enabled) {
    lines.push("", "Files:");
    if (options.artifacts.reportMarkdownPath) lines.push(`- ${options.artifacts.reportMarkdownPath}`);
    if (options.artifacts.reportJsonPath) lines.push(`- ${options.artifacts.reportJsonPath}`);
    if (options.artifacts.normalizedTracePath) lines.push(`- ${options.artifacts.normalizedTracePath}`);
    if (options.artifacts.audioPath) lines.push(`- ${options.artifacts.audioPath}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatVoice(voice: VoiceOutputResult): string {
  if (voice.skipped) return "skipped";
  if (voice.success) return `generated (${voice.provider})${voice.audioPath ? `: ${voice.audioPath}` : ""}`;
  return `failed (${voice.provider}): ${voice.error ?? "unknown error"}`;
}
