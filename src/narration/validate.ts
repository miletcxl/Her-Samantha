import type { NarrationResult } from "../core/types.js";

export function validateNarrationResult(value: unknown): NarrationResult {
  if (!isObject(value)) throw new Error("NarrationResult must be an object.");
  if (typeof value.spokenSummary !== "string" || value.spokenSummary.trim().length === 0) {
    throw new Error("NarrationResult.spokenSummary must be a non-empty string.");
  }
  if (!isObject(value.textDetail)) throw new Error("NarrationResult.textDetail must be an object.");
  if (typeof value.shouldSpeak !== "boolean") {
    throw new Error("NarrationResult.shouldSpeak must be a boolean.");
  }
  if (!isVoiceStyle(value.voiceStyle)) {
    throw new Error("NarrationResult.voiceStyle is invalid.");
  }
  if (!Array.isArray(value.warnings)) throw new Error("NarrationResult.warnings must be an array.");
  if (typeof value.fallbackUsed !== "boolean") {
    throw new Error("NarrationResult.fallbackUsed must be a boolean.");
  }

  const textDetail = value.textDetail;
  if (!isStatus(textDetail.status)) throw new Error("NarrationResult.textDetail.status is invalid.");
  if (typeof textDetail.userTask !== "string") {
    throw new Error("NarrationResult.textDetail.userTask must be a string.");
  }
  if (typeof textDetail.highLevelSummary !== "string") {
    throw new Error("NarrationResult.textDetail.highLevelSummary must be a string.");
  }
  if (!Array.isArray(textDetail.steps)) {
    throw new Error("NarrationResult.textDetail.steps must be an array.");
  }
  if (!Array.isArray(textDetail.errors)) {
    throw new Error("NarrationResult.textDetail.errors must be an array.");
  }

  return value as NarrationResult;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isVoiceStyle(value: unknown): boolean {
  return value === "warm_assistant" || value === "neutral" || value === "concise";
}

function isStatus(value: unknown): boolean {
  return value === "completed" || value === "failed" || value === "aborted" || value === "partial";
}
