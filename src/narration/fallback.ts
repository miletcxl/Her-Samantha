import type { NarrationInput, NarrationResult } from "../core/types.js";

export function createFallbackNarration(input: NarrationInput, warning: string): NarrationResult {
  const completed = input.finalResult?.status === "completed";
  const selected = input.finalResult?.selectedItem;
  const resultText = selected ? `最终结果是 ${selected}。` : "最终结果已经保留在文字详情里。";

  return {
    spokenSummary: completed
      ? `我已经根据这次执行轨迹整理好了结果。${resultText} 具体步骤和判断依据我放在文字详情里，语音里就不逐条展开了。`
      : "这次任务没有完整完成。我已经把已完成的步骤、失败原因和可追溯细节整理在文字详情里，方便你继续判断。",
    textDetail: {
      status: input.finalResult?.status ?? "partial",
      userTask: input.userTask,
      highLevelSummary: "使用保守 fallback 根据 normalized trace 生成文字详情。",
      steps: input.trace.map((event) => ({
        turnId: event.turnId,
        type: event.type,
        target: event.target,
        summary: event.resultSummary ?? event.publicMessage,
        status: event.status
      })),
      finalResult: input.finalResult as Record<string, unknown> | undefined,
      errors: [{ message: warning, source: "narration-provider", recoverable: true }]
    },
    shouldSpeak: true,
    voiceStyle: input.voiceStyle,
    riskNote: null,
    warnings: [...input.warnings, warning],
    fallbackUsed: true
  };
}
