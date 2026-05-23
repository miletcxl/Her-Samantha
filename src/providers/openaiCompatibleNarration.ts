import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NarrationInput, NarrationResult } from "../core/types.js";
import { collectNarrationPolicyWarnings } from "../narration/policy.js";
import { validateNarrationResult } from "../narration/validate.js";
import type { OpenAICompatibleNarrationConfig } from "./config.js";

export async function createOpenAICompatibleNarration(
  input: NarrationInput,
  config: OpenAICompatibleNarrationConfig,
  fetchImpl: typeof fetch = fetch
): Promise<NarrationResult> {
  const systemPrompt = await buildSystemPrompt();

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
          content: systemPrompt
        },
        {
          role: "user",
          content: buildNarrationUserPrompt(input)
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

function buildNarrationUserPrompt(input: NarrationInput): string {
  const finalAnswer = input.finalResult?.finalAnswer;
  const stepSummaries = input.trace
    .filter((e) => e.type !== "error" && e.importance !== "low")
    .map((e) => `- [${e.type}] ${e.resultSummary ?? e.publicMessage}`)
    .join("\n");

  const status = input.finalResult?.status ?? "partial";
  const errorNotes = input.finalResult?.status === "failed" || input.finalResult?.status === "partial"
    ? `\nNote: the task ${status}. Be honest about this in your response.`
    : "";

  return `The user said: "${input.userTask}"

The backend agent executed the task${finalAnswer ? ` and replied:\n"""\n${finalAnswer}\n"""` : "."}
${errorNotes}

Execution trace (for context, do NOT repeat raw):
${stepSummaries || "(minimal trace)"}

---
You are Samantha（萨曼莎）. The user is talking to YOU, not the backend agent.
Respond naturally in Chinese (${input.locale}).

If the user asked about your identity or greeted you:
- Introduce yourself as Samantha（萨曼莎）, their companion voice assistant.
- Briefly explain you work alongside a backend engine that handles the technical work.
- Be warm and conversational, NOT like a log summary.

If this was a normal task:
- Give a warm, conversational spoken summary.
- Do NOT repeat the backend agent's words verbatim — rephrase in your own voice.
- spokenSummary must be concise (under 200 chars), suitable for TTS voice playback.

Output valid JSON matching this schema:
{
  "spokenSummary": "string — your natural spoken response as Samantha",
  "textDetail": {
    "status": "${status}",
    "userTask": "string",
    "highLevelSummary": "string",
    "steps": [{"turnId": 0, "type": "...", "summary": "...", "status": "ok|warning|error"}],
    "finalResult": {},
    "errors": [{"message": "...", "source": "...", "recoverable": true}]
  },
  "shouldSpeak": true,
  "voiceStyle": "warm_assistant|neutral|concise",
  "riskNote": "string|null",
  "warnings": [],
  "fallbackUsed": false
}

Choose voiceStyle based on the emotional context:
- "warm_assistant" (default): casual chat, greetings, normal tasks
- "neutral": technical or factual information
- "concise": very short status updates`;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

const BASE_PROMPT = `You generate Her-Samantha NarrationResult JSON. Do not reveal private chain-of-thought. Do not invent actions. spokenSummary must be concise Chinese suitable for speech. Do not put long paths, JSON, stack traces, or tool logs in spokenSummary. Return only valid JSON matching the requested shape.`;

const SAMANTHA_DIR = ".samantha";

async function buildSystemPrompt(): Promise<string> {
  const agentMd = await readFileIfExists(join(SAMANTHA_DIR, "agent.md"));
  const narrationMd = await readFileIfExists(join(SAMANTHA_DIR, "narration-policy.md"));

  const parts = [BASE_PROMPT];
  if (agentMd) {
    parts.push(`\n---\n## Samantha Agent Persona\n${agentMd}`);
  }
  if (narrationMd) {
    parts.push(`\n---\n## Narration Policy\n${narrationMd}`);
  }

  return parts.join("\n");
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
