import type { NarrationInput, NarrationResult } from "../core/types.js";
import { collectNarrationPolicyWarnings } from "../narration/policy.js";
import { validateNarrationResult } from "../narration/validate.js";
import type { OpenAICompatibleNarrationConfig } from "./config.js";

export async function createOpenAICompatibleNarration(
  input: NarrationInput,
  config: OpenAICompatibleNarrationConfig,
  fetchImpl: typeof fetch = fetch
): Promise<NarrationResult> {
  const response = await fetchImpl(buildChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      "api-key": config.apiKey
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate Her-Samantha NarrationResult JSON. Do not reveal private chain-of-thought. Do not invent actions. spokenSummary must be concise Chinese suitable for speech. Do not put long paths, JSON, stack traces, or tool logs in spokenSummary. Return only valid JSON matching the requested shape."
        },
        {
          role: "user",
          content: JSON.stringify({
            userTask: input.userTask,
            locale: input.locale,
            voiceStyle: input.voiceStyle,
            trace: input.trace,
            finalResult: input.finalResult,
            requiredShape: {
              spokenSummary: "string",
              textDetail: {
                status: "completed|failed|aborted|partial",
                userTask: "string",
                highLevelSummary: "string",
                steps: [],
                finalResult: {},
                errors: []
              },
              shouldSpeak: "boolean",
              voiceStyle: "warm_assistant|neutral|concise",
              riskNote: "string|null",
              warnings: [],
              fallbackUsed: false
            }
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Narration provider HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as any;
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Narration provider response did not include choices[0].message.content.");
  }

  const parsed = JSON.parse(stripJsonFence(content)) as unknown;
  const validated = validateNarrationResult(parsed);
  return {
    ...validated,
    warnings: [...validated.warnings, ...collectNarrationPolicyWarnings(validated.spokenSummary)]
  };
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}
