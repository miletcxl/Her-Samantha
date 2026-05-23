import type { AgentTraceEvent, NarrationInput, NarrationResult } from "../core/types.js";

export function createMockNarration(input: NarrationInput): NarrationResult {
  if (!isLettersDemo(input)) {
    return createGenericMockNarration(input);
  }

  const selectedLetter = input.finalResult?.selectedItem ?? "letter_03.txt";
  const reason =
    input.finalResult?.reason ??
    "这封信最打动人的地方在于它用克制的表达呈现出真诚的遗憾和温柔。";

  return {
    spokenSummary:
      "我已经读完这些信件，并比较了它们表达情绪的方式。最后我选了第三封，因为它最打动人的地方不是措辞强烈，而是那种克制里的真诚和遗憾。更具体的比较我放在文字详情里。",
    textDetail: {
      status: input.finalResult?.status ?? "completed",
      userTask: input.userTask,
      highLevelSummary: "完成了信件阅读、主题提取、情绪比较和最终选择。",
      steps: input.trace.map(toStep),
      finalResult: input.finalResult as Record<string, unknown> | undefined,
      errors: [],
      lettersDemo: {
        selectedLetter,
        reason,
        letterSummaries: [
          {
            file: "letter_01.txt",
            theme: "感谢",
            emotion: "温暖、平静",
            highlight: "表达了对过去陪伴的珍惜。"
          },
          {
            file: "letter_02.txt",
            theme: "告别",
            emotion: "直接、悲伤",
            highlight: "情绪强烈，但表达略直白。"
          },
          {
            file: "letter_03.txt",
            theme: "遗憾与祝福",
            emotion: "克制、真诚",
            highlight: "在克制表达中体现出更深的情感。"
          },
          {
            file: "letter_04.txt",
            theme: "回忆",
            emotion: "柔和、怀念",
            highlight: "有清晰画面感，但最终情感张力稍弱。"
          }
        ]
      }
    },
    shouldSpeak: true,
    voiceStyle: input.voiceStyle,
    riskNote: null,
    warnings: [...input.warnings],
    fallbackUsed: false
  };
}

function createGenericMockNarration(input: NarrationInput): NarrationResult {
  const finalAnswer = input.finalResult?.finalAnswer;
  const highLevelSummary =
    finalAnswer ??
    input.trace
      .map((event) => event.resultSummary ?? event.publicMessage)
      .filter(Boolean)
      .at(-1) ??
    "Task reached the narration stage.";

  const stepCount = input.trace.filter((e) => e.type !== "error" && e.type !== "aborted").length;
  const errorCount = input.trace.filter((e) => e.type === "error").length;

  const spokenSummary =
    input.finalResult?.status === "failed"
      ? "任务未能完成。Pi 在处理过程中遇到了问题，建议按 ctrl+alt+2 查看 Detail 了解详情。"
      : input.finalResult?.status === "aborted"
        ? "任务已被中断。Pi 没有完整执行完你的请求，已完成的步骤保留在 Detail 中。"
        : errorCount > 0
          ? `任务基本完成，但过程中出现了 ${errorCount} 个问题。你可以按 ctrl+alt+2 查看具体细节。`
          : `任务已完成。Pi 执行了 ${stepCount} 个步骤，你可以在左侧对话中查看具体回复。`;

  return {
    spokenSummary,
    textDetail: {
      status: input.finalResult?.status ?? "partial",
      userTask: input.userTask,
      highLevelSummary,
      steps: input.trace.map(toStep),
      finalResult: input.finalResult as Record<string, unknown> | undefined,
      errors:
        input.finalResult?.status === "failed" || input.finalResult?.status === "partial"
          ? [
              {
                message: highLevelSummary,
                source: input.runtime,
                recoverable: true
              }
            ]
          : []
    },
    shouldSpeak: true,
    voiceStyle: input.voiceStyle,
    riskNote: null,
    warnings: [...input.warnings],
    fallbackUsed: false
  };
}

function isLettersDemo(input: NarrationInput): boolean {
  return input.finalResult?.selectedItem?.startsWith("letter_") === true;
}

function toStep(event: AgentTraceEvent): NarrationResult["textDetail"]["steps"][number] {
  return {
    turnId: event.turnId,
    type: event.type,
    target: event.target,
    summary: event.resultSummary ?? event.publicMessage,
    status: event.status
  };
}
