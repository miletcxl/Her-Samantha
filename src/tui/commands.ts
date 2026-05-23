export type ModelKind = "agent" | "narr" | "tts";

export type ProviderAction = "list" | "use" | "test" | "delete";

export type TuiSlashCommand =
  | { type: "voice"; enabled?: boolean; test?: boolean }
  | { type: "model"; kind?: ModelKind; value?: string }
  | { type: "provider"; action: ProviderAction; capability?: string; providerName?: string }
  | { type: "login"; value?: string }
  | { type: "session" }
  | { type: "resume"; value?: string }
  | { type: "save" }
  | { type: "clear" }
  | { type: "help" }
  | { type: "exit" }
  | { type: "unknown"; name: string };

export const TUI_COMMANDS = [
  "/voice",
  "/voice on",
  "/voice off",
  "/voice test",
  "/model",
  "/model agent",
  "/model narr",
  "/model tts",
  "/login",
  "/provider list",
  "/provider use",
  "/provider test",
  "/provider delete",
  "/session",
  "/resume",
  "/save",
  "/clear",
  "/help",
  "/exit"
] as const;

export function parseTuiSlashCommand(input: string): TuiSlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  const name = rawName?.toLowerCase() ?? "";
  const value = rest.join(" ").trim() || undefined;

  if (name === "voice") {
    if (value === "on") return { type: "voice", enabled: true };
    if (value === "off") return { type: "voice", enabled: false };
    if (value === "test") return { type: "voice", test: true };
    return { type: "voice" };
  }
  if (name === "model") {
    const [sub, ...subRest] = rest;
    const subName = sub?.toLowerCase();
    if (subName === "agent" || subName === "narr" || subName === "tts") {
      return { type: "model", kind: subName, value: subRest.join(" ").trim() || undefined };
    }
    return { type: "model", value };
  }
  if (name === "login") return { type: "login", value };
  if (name === "provider") {
    const [action, cap, provName] = rest;
    const actionName = action?.toLowerCase();
    if (actionName === "list" || actionName === "use" || actionName === "test" || actionName === "delete") {
      return {
        type: "provider",
        action: actionName,
        capability: cap?.toLowerCase(),
        providerName: provName?.toLowerCase()
      };
    }
    return { type: "provider", action: "list" };
  }
  if (name === "session") return { type: "session" };
  if (name === "resume") return { type: "resume", value };
  if (name === "save") return { type: "save" };
  if (name === "clear") return { type: "clear" };
  if (name === "help") return { type: "help" };
  if (name === "exit" || name === "quit") return { type: "exit" };
  return { type: "unknown", name };
}

export const TUI_HELP_TEXT =
  "/voice [on|off|test]  /model [agent|narr|tts] <id>  /login  /provider list|use|test|delete  /session  /resume [id|path]  /save  /clear  /help  /exit";
