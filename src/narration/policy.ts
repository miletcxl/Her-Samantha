export function collectNarrationPolicyWarnings(spokenSummary: string): string[] {
  const warnings: string[] = [];
  if (containsLongPath(spokenSummary)) warnings.push("spokenSummary may contain a long path.");
  if (looksLikeJson(spokenSummary)) warnings.push("spokenSummary may contain JSON-like content.");
  if (looksLikeStackTrace(spokenSummary)) warnings.push("spokenSummary may contain a stack trace.");
  if (countFileNames(spokenSummary) > 2) warnings.push("spokenSummary contains more than two file names.");
  return warnings;
}

function containsLongPath(value: string): boolean {
  return /[A-Za-z]:\\[^，。\s]{20,}|\/[^，。\s]{20,}\/[^，。\s]{5,}/.test(value);
}

function looksLikeJson(value: string): boolean {
  return /[{[]\s*"[\w-]+"\s*:/.test(value);
}

function looksLikeStackTrace(value: string): boolean {
  return /\bat\s+[\w.$<>]+\s*\(|Traceback \(most recent call last\)/.test(value);
}

function countFileNames(value: string): number {
  const matches = value.match(/\b[\w.-]+\.(?:txt|md|json|ts|js|tsx|jsx|py|wav|mp3)\b/g);
  return matches?.length ?? 0;
}
