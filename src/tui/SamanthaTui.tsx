import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { writeArtifacts } from "../artifacts/writer.js";
import { createFallbackNarration } from "../narration/fallback.js";
import { collectNarrationPolicyWarnings } from "../narration/policy.js";
import { playAudioFile } from "../providers/audioPlayback.js";
import { readNarrationConfigFromRegistry, readTtsConfigFromRegistry } from "../providers/config.js";
import {
  loadProviderRegistry,
  saveProviderRegistry,
  resolveApiKey,
  writeLocalEnv,
  autoGenerateKeyEnvName,
  testProviderConnection,
  type ProviderRegistry,
  type CapabilityRegistry,
  type ProviderEntry
} from "../providers/registry.js";
import { createMockNarration } from "../providers/mockNarration.js";
import { synthesizeMockTts } from "../providers/mockTts.js";
import { synthesizeMimoTts } from "../providers/mimoTts.js";
import { createOpenAICompatibleNarration } from "../providers/openaiCompatibleNarration.js";
import { PiRuntimeAdapter } from "../runtimes/pi.js";
import type { AgentTraceEvent, NarrationInput, NarrationResult, TaskExecutionResult, VoiceOutputResult } from "../core/types.js";
import { parseTuiSlashCommand, TUI_HELP_TEXT, type TuiSlashCommand } from "./commands.js";

type ConversationEntry =
  | { role: "system" | "user" | "pi" | "samantha" | "permission"; text: string; status?: "ok" | "warning" | "error" };

type RightPanel = "none" | "summary" | "detail" | "final" | "risk";
type PresenceState = "idle" | "listening" | "thinking" | "speaking" | "warning" | "error";

type LoginWizardState =
  | { step: "idle" }
  | { step: "capability" }
  | { step: "providerName"; capability: string }
  | { step: "baseUrl"; capability: string; providerName: string }
  | { step: "model"; capability: string; providerName: string; baseUrl: string }
  | { step: "apiKey"; capability: string; providerName: string; baseUrl: string; model: string }
  | { step: "voiceDescription"; capability: string; providerName: string; baseUrl: string; model: string; apiKey: string }
  | { step: "outputFormat"; capability: string; providerName: string; baseUrl: string; model: string; apiKey: string; voiceDescription: string }
  | { step: "confirmSave"; capability: string; providerName: string; baseUrl: string; model: string; apiKey: string; voiceDescription?: string; outputFormat?: "mp3" | "wav"; error?: string };

export interface SamanthaTuiProps {
  runtime: "pi";
  piPath?: string;
  piTimeoutMs?: number;
  piSessionDir?: string;
  piSession?: string;
  piContinue?: boolean;
  piResume?: boolean;
  piFork?: string;
  voice: boolean;
  ttsProvider: "mock" | "mimo";
  narrationProvider: "mock" | "openai-compatible";
  saveArtifacts: boolean;
  outDir: string;
  locale?: string;
}

export function SamanthaTui(props: SamanthaTuiProps): React.ReactElement {
  const { exit } = useApp();
  const adapterRef = useRef<PiRuntimeAdapter | undefined>(undefined);
  const mountedRef = useRef(true);
  const temporaryAudioPathsRef = useRef<string[]>([]);
  const [input, setInput] = useState("");
  const [conversation, setConversation] = useState<ConversationEntry[]>([
    { role: "system", text: "Her-Samantha Pi harness shell started." }
  ]);
  const [trace, setTrace] = useState<AgentTraceEvent[]>([]);
  const [summary, setSummary] = useState("No summary yet.");
  const [detail, setDetail] = useState("No detail yet.");
  const [finalAnswer, setFinalAnswer] = useState("No final answer yet.");
  const [risk, setRisk] = useState("Risk: none");
  const [status, setStatus] = useState("Starting Pi RPC...");
  const [running, setRunning] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(props.voice);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [sessionLabel, setSessionLabel] = useState(props.piSession ?? (props.piContinue ? "continue" : "new"));
  const [artifactLabel, setArtifactLabel] = useState(props.saveArtifacts ? props.outDir : "off");
  const [provider, setProvider] = useState(process.env.SAMANTHA_PI_PROVIDER ?? "auto");
  const [agentModel, setAgentModel] = useState(process.env.SAMANTHA_PI_MODEL ?? "auto");
  const [narrationModel, setNarrationModel] = useState(process.env.SAMANTHA_NARRATION_MODEL ?? "auto");
  const [ttsModel, setTtsModel] = useState(process.env.SAMANTHA_TTS_MODEL ??
    (props.ttsProvider === "mimo" ? "mimo-v2.5-tts-voicedesign" : "auto"));
  const [expandedPanel, setExpandedPanel] = useState<RightPanel>("none");
  const [lastAudioPath, setLastAudioPath] = useState<string | undefined>();
  const [pulse, setPulse] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [registry, setRegistry] = useState<ProviderRegistry | null>(null);
  const [loginWizard, setLoginWizard] = useState<LoginWizardState>({ step: "idle" });

  const startRuntime = useCallback(
    async (options: { session?: string; resume?: boolean; continueSession?: boolean; fork?: string }): Promise<void> => {
      await adapterRef.current?.dispose();
      setStatus("Starting Pi RPC...");
      const adapter = new PiRuntimeAdapter({
        piPath: props.piPath,
        realExecution: true,
        timeoutMs: props.piTimeoutMs,
        model: agentModel !== "auto" ? agentModel : undefined,
        sessionDir: props.piSessionDir,
        session: options.session,
        continueSession: options.continueSession,
        resume: options.resume,
        fork: options.fork
      });
      adapterRef.current = adapter;
      adapter.subscribe((event) => {
        if (!mountedRef.current) return;
        if (event.type === "status") setStatus(event.message);
        if (event.type === "trace") setTrace((events) => [...events, event.event].slice(-30));
        if (event.type === "permission_prompt") {
          push({ role: "permission", text: event.options?.length ? `${event.message} (${event.options.join("/")})` : event.message });
        }
      });
      try {
        await adapter.start();
        if (mountedRef.current) setStatus("Pi RPC ready.");
      } catch (error) {
        if (mountedRef.current) setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [props.piPath, props.piSessionDir, props.piTimeoutMs, agentModel]
  );

  useEffect(() => {
    mountedRef.current = true;
    void startRuntime({ session: props.piSession, resume: props.piResume, continueSession: props.piContinue, fork: props.piFork });
    return () => {
      mountedRef.current = false;
      void adapterRef.current?.dispose();
      for (const path of temporaryAudioPathsRef.current) {
        void rm(path, { force: true });
      }
    };
  }, [props.piContinue, props.piFork, props.piResume, props.piSession, startRuntime]);

  useEffect(() => {
    loadProviderRegistry().then((reg) => {
      setRegistry(reg);
      if (reg) {
        syncModelsFromRegistry(reg);
      }
    }).catch(() => {});
    const timer = setInterval(() => setPulse((value) => (value + 1) % 4), 280);
    return () => clearInterval(timer);
  }, []);

  function syncModelsFromRegistry(reg: ProviderRegistry): void {
    if (reg.narration) {
      const narrEntry = reg.narration.providers[reg.narration.active];
      if (narrEntry) setNarrationModel(narrEntry.model);
    }
    if (reg.tts) {
      const ttsEntry = reg.tts.providers[reg.tts.active];
      if (ttsEntry) setTtsModel(ttsEntry.model);
    }
  }

  const selectionOptions = useMemo(() => getSelectionOptions(input, registry, agentModel, narrationModel, ttsModel), [input, registry, agentModel, narrationModel, ttsModel]);

  useInput((inputChar, key) => {
    if (loginWizard.step !== "idle" && key.escape) {
      setLoginWizard({ step: "idle" });
      setInput("");
      push({ role: "system", text: "Login wizard cancelled." });
      return;
    }
    if (loginWizard.step !== "idle" && key.return) {
      const text = input.trim();
      setInput("");
      if (text) void advanceWizard(text);
      return;
    }
    if (loginWizard.step !== "idle") {
      if (key.backspace || key.delete) {
        setInput((value) => value.slice(0, -1));
      } else if (!key.ctrl && !key.meta && inputChar) {
        setInput((value) => `${value}${inputChar}`);
      }
      return;
    }

    if (selectionOptions.length > 0 && (key.downArrow || (key as Record<string,unknown>).downArrow)) {
      setSuggestionIndex((value) => (value + 1) % selectionOptions.length);
      return;
    }
    if (selectionOptions.length > 0 && (key.upArrow || (key as Record<string,unknown>).upArrow)) {
      setSuggestionIndex((value) => (value - 1 + selectionOptions.length) % selectionOptions.length);
      return;
    }
    if (selectionOptions.length > 0 && key.return) {
      const selected = selectionOptions[suggestionIndex % selectionOptions.length];
      if (selected) {
        if (selected.action === "complete") {
          setInput(selected.value);
        } else {
          setInput("");
          void submit(selected.value);
        }
        setSuggestionIndex(0);
        return;
      }
    }
    if (selectionOptions.length > 0 && key.tab) {
      const selected = selectionOptions[suggestionIndex % selectionOptions.length];
      if (selected) {
        setInput(selected.action === "complete" ? selected.value : selected.label);
      }
      return;
    }

    if (key.escape) {
      void adapterRef.current?.cancel();
      setStatus("Cancel requested.");
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (!text || running) return;
      setInput("");
      void submit(text);
      return;
    }
    if (!running && input.length === 0 && isControlAltShortcut(inputChar, key, "1")) {
      setExpandedPanel((panel) => (panel === "summary" ? "none" : "summary"));
      return;
    }
    if (!running && input.length === 0 && isControlAltShortcut(inputChar, key, "2")) {
      setExpandedPanel((panel) => (panel === "detail" ? "none" : "detail"));
      return;
    }
    if (!running && input.length === 0 && isControlAltShortcut(inputChar, key, "3")) {
      setExpandedPanel((panel) => (panel === "final" ? "none" : "final"));
      return;
    }
    if (!running && input.length === 0 && isControlAltShortcut(inputChar, key, "4")) {
      setExpandedPanel((panel) => (panel === "risk" ? "none" : "risk"));
      return;
    }
    if (!running && input.length === 0 && isControlAltShortcut(inputChar, key, "q")) {
      setExpandedPanel("none");
      return;
    }
    if (!running && input.length === 0 && isControlAltShortcut(inputChar, key, "v")) {
      void replayVoice();
      return;
    }
    if ((key.backspace || key.delete) && !running) {
      setInput((value) => value.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && inputChar && !running) {
      setInput((value) => `${value}${inputChar}`);
      setSuggestionIndex(0);
    }
  });

  async function advanceWizard(text: string): Promise<void> {
    const ws = loginWizard;

    if (ws.step === "capability") {
      const cap = (text || "narration").toLowerCase();
      if (cap !== "narration" && cap !== "tts" && cap !== "narr") {
        push({ role: "system", text: `Invalid: ${text}. Type "narration" or "tts" (or Enter for narration).`, status: "warning" });
        return;
      }
      const capability = cap === "narr" ? "narration" : cap;
      setLoginWizard({ step: "providerName", capability });
      push({ role: "system", text: `→ ${capability}\nEnter provider name (e.g., deepseek, openai):` });
      return;
    }

    if (ws.step === "providerName") {
      if (!text || text.includes(" ")) {
        push({ role: "system", text: "Name must be one word, no spaces.", status: "warning" });
        return;
      }
      setLoginWizard({ step: "baseUrl", capability: ws.capability, providerName: text });
      push({ role: "system", text: `→ ${text}\nEnter base URL (e.g., https://api.deepseek.com):` });
      return;
    }

    if (ws.step === "baseUrl") {
      if (!text.startsWith("http")) {
        push({ role: "system", text: "URL must start with http:// or https://", status: "warning" });
        return;
      }
      setLoginWizard({ step: "model", capability: ws.capability, providerName: ws.providerName, baseUrl: text });
      push({ role: "system", text: `→ ${text}\nEnter model ID:` });
      return;
    }

    if (ws.step === "model") {
      if (!text) {
        push({ role: "system", text: "Model ID is required.", status: "warning" });
        return;
      }
      setLoginWizard({ step: "apiKey", capability: ws.capability, providerName: ws.providerName, baseUrl: ws.baseUrl, model: text });
      push({ role: "system", text: `→ ${text}\nEnter API key (saved to .env.local, NOT displayed):` });
      return;
    }

    if (ws.step === "apiKey") {
      if (!text) {
        push({ role: "system", text: "API key is required.", status: "warning" });
        return;
      }
      if (ws.capability === "tts") {
        setLoginWizard({
          step: "voiceDescription",
          capability: ws.capability, providerName: ws.providerName,
          baseUrl: ws.baseUrl, model: ws.model, apiKey: text
        });
        push({ role: "system", text: "→ (hidden)\nEnter voice description (e.g., warm natural Chinese female voice):" });
      } else {
        setLoginWizard({
          step: "confirmSave",
          capability: ws.capability, providerName: ws.providerName,
          baseUrl: ws.baseUrl, model: ws.model, apiKey: text
        });
        push({ role: "system", text: `  Capability : ${ws.capability}\n  Provider   : ${ws.providerName}\n  Base URL   : ${ws.baseUrl}\n  Model      : ${ws.model}\n  API key    : (hidden)\n\nSave? Enter=y, Esc=cancel` });
      }
      return;
    }

    if (ws.step === "voiceDescription") {
      if (!text) {
        push({ role: "system", text: "Voice description is required for TTS.", status: "warning" });
        return;
      }
      setLoginWizard({
        step: "outputFormat",
        capability: ws.capability, providerName: ws.providerName,
        baseUrl: ws.baseUrl, model: ws.model, apiKey: ws.apiKey,
        voiceDescription: text
      });
      push({ role: "system", text: `→ ${text}\nOutput format: mp3 or wav (Enter=mp3):` });
      return;
    }

    if (ws.step === "outputFormat") {
      const fmt: "mp3" | "wav" = text.toLowerCase() === "wav" ? "wav" : "mp3";
      setLoginWizard({
        step: "confirmSave",
        capability: ws.capability, providerName: ws.providerName,
        baseUrl: ws.baseUrl, model: ws.model, apiKey: ws.apiKey,
        voiceDescription: ws.voiceDescription, outputFormat: fmt
      });
      push({ role: "system", text: `  Capability : ${ws.capability}\n  Provider   : ${ws.providerName}\n  Base URL   : ${ws.baseUrl}\n  Model      : ${ws.model}\n  Voice      : ${ws.voiceDescription}\n  Format     : ${fmt}\n  API key    : (hidden)\n\nSave? Enter=y, Esc=cancel` });
      return;
    }

    if (ws.step === "confirmSave") {
      if (text === "n" || text === "no") {
        push({ role: "system", text: "Cancelled." });
        setLoginWizard({ step: "idle" });
        return;
      }
      if (text === "y" || text === "yes" || text === "") {
        push({ role: "system", text: "Saving..." });
        try {
          const envName = autoGenerateKeyEnvName(ws.providerName, ws.capability);
          await writeLocalEnv(envName, ws.apiKey);
          process.env[envName] = ws.apiKey;

          const reg = registry ?? {};
          const entry: ProviderEntry = {
            baseUrl: ws.baseUrl,
            model: ws.model,
            apiKeyRef: `env:${envName}`
          };
          if (ws.voiceDescription) entry.voiceDescription = ws.voiceDescription;
          if (ws.outputFormat) entry.outputFormat = ws.outputFormat;

          const capKey = ws.capability as "narration" | "tts";
          const capability: CapabilityRegistry = reg[capKey]
            ? { ...reg[capKey]!, active: ws.providerName, providers: { ...reg[capKey]!.providers, [ws.providerName]: entry } }
            : { active: ws.providerName, providers: { [ws.providerName]: entry } };

          const updated: ProviderRegistry = { ...reg, [capKey]: capability };
          await saveProviderRegistry(updated);
          setRegistry(updated);
          syncModelsFromRegistry(updated);

          push({ role: "system", text: `Provider "${ws.providerName}" saved as ${ws.capability} provider. Key saved to .samantha/.env.local as ${envName}.` });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          push({ role: "system", text: `Failed to save provider: ${msg}`, status: "error" });
        }
        setLoginWizard({ step: "idle" });
      } else {
        push({ role: "system", text: "Login cancelled." });
        setLoginWizard({ step: "idle" });
      }
      return;
    }
  }

  async function submit(text: string): Promise<void> {
    const command = parseTuiSlashCommand(text);
    if (command) {
      await runCommand(command);
      return;
    }

    const adapter = adapterRef.current;
    if (!adapter) {
      setStatus("Pi runtime is not ready.");
      return;
    }

    setRunning(true);
    setVoiceStatus(voiceEnabled ? "waiting for Pi" : "off");
    push({ role: "user", text });
    try {
      const execution = await adapter.sendTask(text);
      const finalAnswer = execution.finalResult.finalAnswer ?? execution.trace.at(-1)?.resultSummary ?? "Pi completed.";
      setFinalAnswer(finalAnswer);
      push({ role: "pi", text: finalAnswer });
      const narration = await createNarration(execution, props, narrationModel);
      setSummary(narration.spokenSummary);
      setDetail(formatDetail(narration));
      setRisk(narration.riskNote ?? "Risk: none");
      push({ role: "samantha", text: narration.spokenSummary });
      const runId = createRunId();
      const voice = await runVoice(narration.spokenSummary, props, voiceEnabled, setVoiceStatus, runId, ttsModel);
      if (voice.audioPath) {
        setLastAudioPath(voice.audioPath);
        if (voice.temporary) temporaryAudioPathsRef.current.push(voice.audioPath);
      }
      if (voice.error) push({ role: "samantha", text: `Voice warning: ${voice.error}`, status: "warning" });
      const artifacts = await writeArtifacts({
        enabled: props.saveArtifacts,
        outDir: props.outDir,
        runId,
        execution,
        trace: execution.trace,
        narration,
        voice
      });
      setArtifactLabel(artifacts.outputDir ?? (props.saveArtifacts ? props.outDir : "off"));
      setStatus("Ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      push({ role: "system", text: message, status: "error" });
      setStatus(message);
    } finally {
      setRunning(false);
      setVoiceStatus((value) => (value === "playing" || value === "generating" ? "done" : value));
    }
  }

  async function replayVoice(): Promise<void> {
    if (!lastAudioPath) {
      push({ role: "system", text: "No voice audio is available to replay.", status: "warning" });
      return;
    }
    setVoiceStatus("playing");
    const playback = await playAudioFile(lastAudioPath);
    setVoiceStatus(playback.played ? "done" : "warning");
    if (playback.error) push({ role: "samantha", text: `Replay warning: ${playback.error}`, status: "warning" });
  }

  async function runVoiceTest(): Promise<void> {
    setVoiceStatus("generating");
    const voice = await runVoice("这是一段 Her-Samantha 的语音播放测试。", props, true, setVoiceStatus, createRunId(), ttsModel);
    if (voice.audioPath) {
      setLastAudioPath(voice.audioPath);
      if (voice.temporary) temporaryAudioPathsRef.current.push(voice.audioPath);
    }
    setVoiceStatus(voice.played ? "done" : "warning");
    push({
      role: "system",
      text: voice.success && voice.played ? "Voice test played." : `Voice test failed: ${voice.error ?? "unknown error"}`,
      status: voice.success && voice.played ? "ok" : "warning"
    });
  }

  async function runCommand(command: TuiSlashCommand): Promise<void> {
    switch (command.type) {
      case "voice":
        if (command.test) {
          await runVoiceTest();
          return;
        }
        if (typeof command.enabled === "boolean") setVoiceEnabled(command.enabled);
        push({ role: "system", text: `Voice: ${typeof command.enabled === "boolean" ? (command.enabled ? "on" : "off") : voiceStatus}` });
        return;
      case "model": {
        const kind = command.kind;
        if (!kind) {
          push({ role: "system", text: "Usage: /model narr <id>  |  /model tts <id>  |  /model agent <id>" });
          return;
        }
        if (!command.value) {
          const current = kind === "agent" ? agentModel : kind === "narr" ? narrationModel : ttsModel;
          push({ role: "system", text: `Current ${kind} model: ${current}\nUsage: /model ${kind} <new-model-id>` });
          return;
        }
        if (kind === "agent") {
          setAgentModel(command.value);
          setTrace([]);
          push({ role: "system", text: `Agent model → ${command.value}. Restarting Pi...` });
          await startRuntime({});
          setStatus(`Pi restarted with model: ${command.value}`);
          return;
        }
        if (kind === "narr") {
          setNarrationModel(command.value);
          push({ role: "system", text: `Narration model → ${command.value}. Next task will use it.` });
          return;
        }
        if (kind === "tts") {
          setTtsModel(command.value);
          push({ role: "system", text: `TTS model → ${command.value}. Next voice will use it.` });
          return;
        }
        return;
      }
      case "login": {
        if (running) {
          push({ role: "system", text: "Cannot login while a task is running.", status: "warning" });
          return;
        }
        const parts = (command.value ?? "").split(/\s+/).filter(Boolean);
        if (parts.length >= 3) {
          const [capRaw, providerName, baseUrl, model, ...keyParts] = parts;
          const cap = capRaw?.toLowerCase();
          const capability = (cap === "narr" ? "narration" : cap === "tts" ? "tts" : cap) as string;
          if (capability !== "narration" && capability !== "tts") {
            push({ role: "system", text: `Invalid capability: ${capRaw}. Use "narr", "narration", or "tts".`, status: "warning" });
            return;
          }
          if (!providerName || !baseUrl || !model || !baseUrl.startsWith("http")) {
            push({ role: "system", text: "Usage: /login <narr|tts> <name> <url> <model> [key]", status: "warning" });
            return;
          }
          const apiKey = keyParts.join(" ");
          if (!apiKey) {
            setLoginWizard({ step: "apiKey", capability, providerName, baseUrl, model });
            push({ role: "system", text: `Quick setup: ${capability}/${providerName}/${model} @ ${baseUrl}\nEnter API key:` });
            return;
          }
          void (async () => {
            try {
              const envName = autoGenerateKeyEnvName(providerName, capability);
              await writeLocalEnv(envName, apiKey);
              process.env[envName] = apiKey;
              const entry: ProviderEntry = { baseUrl, model, apiKeyRef: `env:${envName}` };
              const reg = registry ?? {};
              const capKey = capability as "narration" | "tts";
              const capabilityReg: CapabilityRegistry = reg[capKey]
                ? { ...reg[capKey]!, active: providerName, providers: { ...reg[capKey]!.providers, [providerName]: entry } }
                : { active: providerName, providers: { [providerName]: entry } };
              const updated = { ...reg, [capKey]: capabilityReg };
              await saveProviderRegistry(updated);
              setRegistry(updated);
              syncModelsFromRegistry(updated);
              push({ role: "system", text: `Saved! ${capability} provider "${providerName}" (${model}).\nUse /provider use ${capability} ${providerName} to activate.` });
            } catch (error) {
              push({ role: "system", text: `Failed: ${error instanceof Error ? error.message : String(error)}`, status: "error" });
            }
          })();
          return;
        }
        setLoginWizard({ step: "capability" });
        push({ role: "system", text: "=== Login Wizard ===\nSelect capability (Enter=narration):" });
        return;
      }
      case "provider": {
        if (running) {
          push({ role: "system", text: "Cannot manage providers while a task is running.", status: "warning" });
          return;
        }
        if (command.action === "list") {
          const lines = formatProviderList(registry);
          push({ role: "system", text: lines });
          return;
        }
        if (!command.capability || !command.providerName) {
          push({ role: "system", text: "Usage: /provider <list|use|test|delete> [capability] [name]\n  e.g., /provider use narration deepseek", status: "warning" });
          return;
        }
        const cap = command.capability as "narration" | "tts";
        if (command.action === "use") {
          const reg = registry;
          if (!reg?.[cap]?.providers[command.providerName]) {
            push({ role: "system", text: `Provider "${command.providerName}" not found in ${cap} providers.`, status: "warning" });
            return;
          }
          const updated = {
            ...reg,
            [cap]: { ...reg[cap]!, active: command.providerName }
          };
          saveProviderRegistry(updated).then(() => {
            setRegistry(updated);
            syncModelsFromRegistry(updated);
          }).catch((error) => {
            push({ role: "system", text: `Failed to save: ${error instanceof Error ? error.message : String(error)}`, status: "error" });
          });
          push({ role: "system", text: `${cap} active provider → ${command.providerName}. Saving...` });
          return;
        }
        if (command.action === "test") {
          const reg = registry;
          const entry = reg?.[cap]?.providers[command.providerName];
          if (!entry) {
            push({ role: "system", text: `Provider "${command.providerName}" not found in ${cap} providers.`, status: "warning" });
            return;
          }
          push({ role: "system", text: `Testing ${cap} provider "${command.providerName}" at ${entry.baseUrl}...` });
          testProviderConnection(entry, resolveApiKey(entry.apiKeyRef, process.env) ?? "").then((result) => {
            if (result.ok) {
              push({ role: "system", text: `Connection OK. Latency: ${result.latencyMs}ms.` });
            } else {
              push({ role: "system", text: `Connection FAILED: ${result.error ?? "unknown error"} (${result.latencyMs}ms)`, status: "error" });
            }
          }).catch((error) => {
            push({ role: "system", text: `Test error: ${error instanceof Error ? error.message : String(error)}`, status: "error" });
          });
          return;
        }
        if (command.action === "delete") {
          const reg = registry;
          if (!reg?.[cap]?.providers[command.providerName]) {
            push({ role: "system", text: `Provider "${command.providerName}" not found in ${cap} providers.`, status: "warning" });
            return;
          }
          const providers = { ...reg[cap]!.providers };
          delete providers[command.providerName];
          const active = reg[cap]!.active === command.providerName
            ? Object.keys(providers)[0] ?? ""
            : reg[cap]!.active;
          const updated = active
            ? { ...reg, [cap]: { active, providers } }
            : Object.fromEntries(Object.entries(reg).filter(([k]) => k !== cap)) as ProviderRegistry;
          saveProviderRegistry(updated).then(() => {
            setRegistry(updated);
            syncModelsFromRegistry(updated);
          }).catch((error) => {
            push({ role: "system", text: `Failed to delete: ${error instanceof Error ? error.message : String(error)}`, status: "error" });
          });
          push({ role: "system", text: `Deleted ${cap} provider "${command.providerName}".` });
          return;
        }
        return;
      }
      case "session":
        push({ role: "system", text: `Session: ${sessionLabel}; session dir: ${props.piSessionDir ?? "Pi default"}` });
        return;
      case "resume":
        if (!command.value) {
          push({
            role: "system",
            text: "Use /resume <session-id|session-file>. Interactive Pi resume picker is not exposed through Samantha yet.",
            status: "warning"
          });
          return;
        }
        if (running) {
          push({ role: "system", text: "Cannot resume a different session while a turn is running.", status: "warning" });
          return;
        }
        setSessionLabel(command.value);
        setTrace([]);
        push({ role: "system", text: `Resuming Pi session: ${command.value}` });
        await startRuntime({ session: command.value });
        return;
      case "save":
        push({ role: "system", text: `Artifacts: ${artifactLabel}; Pi session dir: ${props.piSessionDir ?? "Pi default"}` });
        return;
      case "clear":
        setConversation([{ role: "system", text: "Conversation cleared. Pi session remains active." }]);
        setTrace([]);
        return;
      case "help":
        push({ role: "system", text: TUI_HELP_TEXT });
        return;
      case "exit":
        exit();
        return;
      case "unknown":
        push({ role: "system", text: `Unknown command: /${command.name}. ${TUI_HELP_TEXT}`, status: "warning" });
    }
  }

  function push(entry: ConversationEntry): void {
    setConversation((items) => [...items, entry].slice(-80));
  }

  const visibleConversation = conversation.slice(-14);
  const presence = getPresenceState({
    input,
    running,
    voiceEnabled,
    voiceStatus,
    status
  });
  const panelContent = useMemo(
    () => getPanelContent(expandedPanel, { summary, detail, finalAnswer, risk }),
    [detail, expandedPanel, finalAnswer, risk, summary]
  );

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color="magentaBright" bold>
          Her-Samantha Pi Harness // SIGNAL ROOM
        </Text>
        <Text color="cyan">
          Pi RPC :: {agentModel} :: voice {voiceEnabled ? "on" : "off"}
        </Text>
      </Box>
      <Box>
        <Box width="68%" flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
          <Box justifyContent="space-between">
            <Text color="magentaBright">pi v0.75.x</Text>
            <Text dimColor>/help  esc cancel  session {sessionLabel}</Text>
          </Box>
          <Text color="gray">{process.cwd()}</Text>
          <Text color="magenta">-- conversation tape --------------------------------</Text>
          <Box marginTop={1} flexDirection="column">
            {visibleConversation.map((entry, index) => (
              <Text key={`${entry.role}-${index}`} color={conversationColor(entry)} wrap="wrap">
                {formatRole(entry.role)} {entry.text}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text color={running ? "gray" : "cyanBright"} bold={!running}>
              {running ? ">> turn locked; waiting for Pi..." : `>> ${input || "Ask Pi, or type / for commands"}${!running && pulse % 2 === 0 ? "_" : " "}`}
            </Text>
          </Box>
          {!running && selectionOptions.length > 0 && (
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
              {selectionOptions.slice(0, 8).map((opt, index) => {
                const selected = index === suggestionIndex % selectionOptions.length;
                return (
                  <Box key={`${opt.label}-${index}`} flexDirection="row">
                    <Text color={selected ? "cyanBright" : "gray"}>
                      {selected ? ">" : " "}
                    </Text>
                    <Text color={selected ? "cyanBright" : "white"} bold={selected}>
                      {" "}{opt.label}
                    </Text>
                    {opt.description && (
                      <Text color="gray"> — {opt.description}</Text>
                    )}
                  </Box>
                );
              })}
              <Text color="gray">  up/down: navigate  enter: select  tab: fill  esc: clear</Text>
            </Box>
          )}
        </Box>
        <SamanthaSignalPanel
          expandedPanel={expandedPanel}
          agentModel={agentModel}
          narrationModel={narrationModel}
          ttsModel={ttsModel}
          panelContent={panelContent}
          presence={presence}
          provider={provider}
          pulse={pulse}
          voiceEnabled={voiceEnabled}
        />
      </Box>
    </Box>
  );
}

function SamanthaSignalPanel(props: {
  expandedPanel: RightPanel;
  agentModel: string;
  narrationModel: string;
  ttsModel: string;
  panelContent: string;
  presence: PresenceState;
  provider: string;
  pulse: number;
  voiceEnabled: boolean;
}): React.ReactElement {
  return (
    <Box
      width="32%"
      flexDirection="column"
      justifyContent="flex-end"
      borderStyle="round"
      borderColor={presenceBorderColor(props.presence)}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color="cyanBright" bold>
          Samantha
        </Text>
        <Text color="gray">{props.provider}</Text>
      </Box>
      <Text color="gray">Pi RPC · {props.agentModel} · voice {props.voiceEnabled ? "on" : "off"}</Text>

      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text color="gray">╭── SIGNAL BODY ──╮</Text>
        <Voiceprint state={props.presence} pulse={props.pulse} />
        <Text color={presenceTextColor(props.presence)} bold>
          {stateGlyph(props.presence)} {props.presence}
        </Text>
      </Box>

      <FoldedSections expandedPanel={props.expandedPanel} panelContent={props.panelContent} />

      <Box marginTop={1} flexDirection="column">
        <Text color="cyan" bold>Models</Text>
        <Text color="gray">agent: {props.agentModel}</Text>
        <Text color="gray">narr:  {props.narrationModel}</Text>
        <Text color="gray">tts:   {props.ttsModel}</Text>
        <Text color="gray" dimColor>/model narr|tts|agent to switch</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">ctrl+alt+v replay · ctrl+alt+1-4 open</Text>
        <Text color="gray">ctrl+alt+q close</Text>
      </Box>
    </Box>
  );
}

function Voiceprint(props: { state: PresenceState; pulse: number }): React.ReactElement {
  const frames: Record<PresenceState, string[][]> = {
    idle: [
      ["  ▁▂▃▂▁     ▁▂▃▂▁  ", "  ─────── · ───────  ", "  ▔▃▂▁▂     ▔▃▂▁▂  "],
      ["   ▁▂▃▂▁   ▁▂▃▂▁   ", "  ────── · ──────   ", "   ▔▃▂▁▂   ▔▃▂▁▂   "],
      ["    ▁▂▃▂▁ ▁▂▃▂▁    ", "   ───── · ─────    ", "    ▔▃▂▁▂ ▔▃▂▁▂    "],
      ["   ▁▂▃▂▁   ▁▂▃▂▁   ", "  ────── · ──────   ", "   ▔▃▂▁▂   ▔▃▂▁▂   "]
    ],
    listening: [
      ["╲  ▁▂▄▆▇▆▄▂▁  ╱", "   ───── ◌ ─────   ", "╱  ▔▆▄▂▁▂▄▆▔  ╲"],
      [" ╲ ▁▂▄▆▇█▇▆▄▂ ╱ ", "   ──── ◌ ────    ", " ╱ ▔▆▄▂▁▂▄▆▔ ╲ "],
      ["  ╲▁▂▄▆█▇▆▄▂╱  ", "    ─── ◌ ───     ", "  ╱▔▆▄▂▁▂▄▆╲  "],
      [" ╲ ▁▂▄▆▇█▇▆▄▂ ╱ ", "   ──── ◌ ────    ", " ╱ ▔▆▄▂▁▂▄▆▔ ╲ "]
    ],
    thinking: [
      [" ▂▁▃▂▄▁▅▂▃▁▄▂▆ ", " ╴╶╴╶╴ ✦ ╶╴╶╴╶ ", " ▔▃▁▂▅▁▄▂▃▁▆▂▔ "],
      [" ▃▁▂▄▁▅▃▁▂▆▁▄▂ ", " ╶╴╶╴╶ ✦ ╴╶╴╶╴ ", " ▔▂▆▁▃▂▄▁▅▂▁▃▔ "],
      [" ▂▄▁▃▅▁▂▆▃▁▄▂▅ ", " ╴╶╴╶╴ ✦ ╶╴╶╴╶ ", " ▔▅▂▄▁▃▆▂▁▅▃▁▔ "],
      [" ▃▁▂▄▁▅▃▁▂▆▁▄▂ ", " ╶╴╶╴╶ ✦ ╴╶╴╶╴ ", " ▔▂▆▁▃▂▄▁▅▂▁▃▔ "]
    ],
    speaking: [
      [" ▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂ ", " ════════ ✦ ════════ ", " ▔▆▄▂▁▂▄▆█▇▅▃▂▁▂▄▆ "],
      [" ▃▅▇█▆▄▂▁▂▄▆█▇▅▃▂▁ ", " ═══════ ✦ ════════ ", " ▔▇▅▃▁▂▄▆█▆▄▂▁▂▄▆▔ "],
      [" ▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁ ", " ════════ ✦ ═══════ ", " ▔█▆▄▂▁▂▄▆█▇▅▃▂▁▂▄ "],
      [" ▃▅▇█▆▄▂▁▂▄▆█▇▅▃▂▁ ", " ═══════ ✦ ════════ ", " ▔▇▅▃▁▂▄▆█▆▄▂▁▂▄▆▔ "]
    ],
    warning: [
      ["      ▃▅▇▅▃      ", "   ──╳── ✦ ──╳──   ", "      ▔▅▃▅▔      "],
      ["     ▂▃▅▇▅▃▂     ", "   ─╳─── ✦ ───╳─   ", "     ▔▅▃▂▃▅▔     "],
      ["      ▃▅▇▅▃      ", "   ──╳── ✦ ──╳──   ", "      ▔▅▃▅▔      "],
      ["     ▂▃▅▇▅▃▂     ", "   ─╳─── ✦ ───╳─   ", "     ▔▅▃▂▃▅▔     "]
    ],
    error: [
      ["      ▇▃  ▃▇      ", "   ×─── ✦ ───×   ", "      ▂▆  ▆▂      "],
      ["    ▇▃      ▃▇    ", "  ×──── ✦ ────×  ", "    ▂▆      ▆▂    "],
      ["      ▇▃  ▃▇      ", "   ×─── ✦ ───×   ", "      ▂▆  ▆▂      "],
      ["    ▇▃      ▃▇    ", "  ×──── ✦ ────×  ", "    ▂▆      ▆▂    "]
    ]
  };
  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column" alignItems="center">
      {frames[props.state][props.pulse].map((line, index) => (
        <Text key={`${props.state}-${props.pulse}-${index}`} color={voiceprintColor(props.state, index)}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function FoldedSections(props: { expandedPanel: RightPanel; panelContent: string }): React.ReactElement {
  return (
    <Box marginTop={1} flexDirection="column">
      <FoldedSection index="01" label="Summary" panel="summary" expandedPanel={props.expandedPanel} panelContent={props.panelContent} />
      <FoldedSection index="02" label="Detail" panel="detail" expandedPanel={props.expandedPanel} panelContent={props.panelContent} />
      <FoldedSection index="03" label="Final Answer" panel="final" expandedPanel={props.expandedPanel} panelContent={props.panelContent} />
      <FoldedSection index="04" label="Risk" panel="risk" expandedPanel={props.expandedPanel} panelContent={props.panelContent} />
    </Box>
  );
}

function FoldedSection(props: {
  expandedPanel: RightPanel;
  index: string;
  label: string;
  panel: Exclude<RightPanel, "none">;
  panelContent: string;
}): React.ReactElement {
  const open = props.expandedPanel === props.panel;
  return (
    <Box flexDirection="column">
      <Text color={open ? "cyanBright" : "white"} bold={open}>
        {open ? "▸" : " "} {props.index} / {props.label}
      </Text>
      {open && (
        <Box paddingLeft={4}>
          <Text color="gray" wrap="wrap">
            {props.panelContent}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function voiceprintColor(state: PresenceState, lineIndex: number): string | undefined {
  if (state === "idle") return lineIndex === 1 ? "gray" : "blueBright";
  if (state === "listening") return "cyanBright";
  if (state === "thinking") return lineIndex === 1 ? "yellow" : "magentaBright";
  if (state === "speaking") return lineIndex === 1 ? "yellow" : "magentaBright";
  if (state === "warning") return "yellow";
  if (state === "error") return "redBright";
  return "white";
}

function stateGlyph(state: PresenceState): string {
  if (state === "idle") return "·";
  if (state === "listening") return "◌";
  if (state === "warning") return "!";
  if (state === "error") return "×";
  return "✦";
}

async function createNarration(execution: TaskExecutionResult, props: SamanthaTuiProps, narrationModel?: string): Promise<NarrationResult> {
  const input: NarrationInput = {
    userTask: execution.userTask,
    runtime: execution.runtime,
    locale: props.locale ?? "zh-CN",
    voiceStyle: "warm_assistant",
    trace: execution.trace,
    finalResult: execution.finalResult,
    warnings: execution.warnings
  };
  try {
    const narration =
      props.narrationProvider === "mock"
        ? createMockNarration(input)
        : await createOpenAICompatibleNarration(input, {
            ...(await readNarrationConfigFromRegistry()),
            ...(narrationModel && narrationModel !== "auto" ? { model: narrationModel } : {})
          });
    return { ...narration, warnings: [...narration.warnings, ...collectNarrationPolicyWarnings(narration.spokenSummary)] };
  } catch (error) {
    return createFallbackNarration(input, error instanceof Error ? error.message : String(error));
  }
}

async function runVoice(
  spokenSummary: string,
  props: SamanthaTuiProps,
  enabled: boolean,
  setVoiceStatus: (status: string) => void,
  runId: string,
  ttsModel?: string
): Promise<VoiceOutputResult> {
  if (!enabled) {
    return { requested: false, skipped: true, success: true, provider: props.ttsProvider, temporary: false, played: false };
  }
  setVoiceStatus("generating");
  const outputFormat = "wav";
  const outputPath = props.saveArtifacts
    ? join(props.outDir, runId, `samantha_summary.${outputFormat}`)
    : join(await mkdtemp(join(tmpdir(), "her-samantha-voice-")), `samantha_summary.${outputFormat}`);

  const generated: VoiceOutputResult =
    props.ttsProvider === "mock"
      ? await synthesizeMockTts({ spokenSummary, outputPath, temporary: !props.saveArtifacts })
      : await withTimeout(
          synthesizeMimoTts({
            spokenSummary,
            outputPath,
            temporary: !props.saveArtifacts,
            config: {
              ...(await readTtsConfigFromRegistry()),
              outputFormat: "wav",
              ...(ttsModel && ttsModel !== "auto" ? { model: ttsModel } : {})
            }
          }),
          60_000,
          "Mimo TTS timed out after 60000ms."
        ).catch((error: unknown): VoiceOutputResult => ({
          requested: true,
          skipped: false,
          success: false,
          provider: "mimo" as const,
          temporary: !props.saveArtifacts,
          played: false,
          error: error instanceof Error ? error.message : String(error)
        }));

  if (!generated.success || !generated.audioPath) return generated;
  setVoiceStatus("playing");
  const playback = await playAudioFile(generated.audioPath);
  return { ...generated, played: playback.played, error: playback.error };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatRole(role: ConversationEntry["role"]): string {
  if (role === "user") return "you      |";
  if (role === "pi") return "pi       |";
  if (role === "samantha") return "samantha |";
  if (role === "permission") return "permit   |";
  return "system   |";
}

function conversationColor(entry: ConversationEntry): string | undefined {
  if (entry.status === "error") return "redBright";
  if (entry.status === "warning") return "yellow";
  if (entry.role === "user") return "cyanBright";
  if (entry.role === "samantha") return "magentaBright";
  if (entry.role === "permission") return "yellow";
  if (entry.role === "system") return "gray";
  return undefined;
}

function formatDetail(narration: NarrationResult): string {
  return narration.textDetail.highLevelSummary || narration.textDetail.steps.map((step) => step.summary).join(" | ") || "No detail.";
}

function getPresenceState(input: {
  input: string;
  running: boolean;
  voiceEnabled: boolean;
  voiceStatus: string;
  status: string;
}): PresenceState {
  if (/error|failed/i.test(input.status)) return "error";
  if (/warning/i.test(input.status) || input.voiceStatus === "warning") return "warning";
  if (input.voiceStatus === "playing" || input.voiceStatus === "generating") return "speaking";
  if (input.running) return "thinking";
  if (input.input.length > 0) return "listening";
  return input.voiceEnabled ? "idle" : "idle";
}

function getPanelContent(
  panel: RightPanel,
  content: { summary: string; detail: string; finalAnswer: string; risk: string }
): string {
  if (panel === "summary") return preview(content.summary, 360);
  if (panel === "detail") return preview(content.detail, 420);
  if (panel === "final") return preview(content.finalAnswer, 420);
  if (panel === "risk") return preview(content.risk, 320);
  return "";
}

function panelTitle(panel: RightPanel): string {
  if (panel === "summary") return "Summary";
  if (panel === "detail") return "Detail";
  if (panel === "final") return "Final";
  if (panel === "risk") return "Risk";
  return "";
}

function preview(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function isControlAltShortcut(
  inputChar: string,
  key: { ctrl?: boolean; meta?: boolean },
  shortcut: "1" | "2" | "3" | "4" | "q" | "v"
): boolean {
  return !key.ctrl && !key.meta && inputChar.toLowerCase() === shortcut;
}

type SelectionOption = {
  label: string;
  description?: string;
  value: string;
  action: "complete" | "submit";
};

function getSelectionOptions(
  input: string,
  registry: ProviderRegistry | null,
  agentModel: string,
  narrationModel: string,
  ttsModel: string
): SelectionOption[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return [];
  if (trimmed.includes(" ")) {
    const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
    return getSubOptions(parts, registry, agentModel, narrationModel, ttsModel);
  }
  // Just "/" or "/partial" — show matching top-level commands
  const prefix = trimmed.slice(1).toLowerCase();
  const cmds: SelectionOption[] = [
    { label: "/voice", description: "Toggle voice on/off/test", value: "/voice ", action: "complete" },
    { label: "/model", description: "Switch agent / narr / tts model", value: "/model ", action: "complete" },
    { label: "/provider", description: "Manage model providers", value: "/provider ", action: "complete" },
    { label: "/login", description: "Add a new provider", value: "/login ", action: "complete" },
    { label: "/session", description: "Show current session", value: "/session", action: "submit" },
    { label: "/resume", description: "Resume a saved session", value: "/resume ", action: "complete" },
    { label: "/save", description: "Show artifact status", value: "/save", action: "submit" },
    { label: "/clear", description: "Clear conversation", value: "/clear", action: "submit" },
    { label: "/help", description: "Show all commands", value: "/help", action: "submit" },
    { label: "/exit", description: "Exit Samantha", value: "/exit", action: "submit" }
  ];
  if (!prefix) return cmds;
  return cmds.filter((o) => o.label.startsWith(`/${prefix}`));
}

function getSubOptions(
  parts: string[],
  registry: ProviderRegistry | null,
  agentModel: string,
  narrationModel: string,
  ttsModel: string
): SelectionOption[] {
  const cmd = parts[0]?.toLowerCase() ?? "";
  const sub = parts[1]?.toLowerCase();

  if (parts.length === 1) {
    if (cmd === "model") {
      return [
        { label: `agent  (current: ${agentModel})`, description: "Switch underlying Pi model", value: `/model agent `, action: "complete" },
        { label: `narr   (current: ${narrationModel})`, description: "Switch narration model", value: `/model narr `, action: "complete" },
        { label: `tts    (current: ${ttsModel})`, description: "Switch TTS voice model", value: `/model tts `, action: "complete" }
      ];
    }
    if (cmd === "provider") {
      return [
        { label: "list", description: "Show all configured providers", value: "/provider list", action: "submit" },
        { label: "use", description: "Switch active provider", value: "/provider use ", action: "complete" },
        { label: "test", description: "Test provider connection", value: "/provider test ", action: "complete" },
        { label: "delete", description: "Remove a provider", value: "/provider delete ", action: "complete" }
      ];
    }
    if (cmd === "login") {
      return [
        { label: "narration", description: "Add a text/narration model provider", value: "/login narr ", action: "complete" },
        { label: "tts", description: "Add a TTS/voice model provider", value: "/login tts ", action: "complete" }
      ];
    }
    if (cmd === "voice") {
      return [
        { label: "on", description: "Enable voice", value: "/voice on", action: "submit" },
        { label: "off", description: "Disable voice", value: "/voice off", action: "submit" },
        { label: "test", description: "Test voice playback", value: "/voice test", action: "submit" }
      ];
    }
    return [];
  }

  if (cmd === "model" && parts.length === 2) {
    const opts: SelectionOption[] = [
      { label: `agent  (current: ${agentModel})`, description: "Switch underlying Pi model", value: `/model agent `, action: "complete" },
      { label: `narr   (current: ${narrationModel})`, description: "Switch narration model", value: `/model narr `, action: "complete" },
      { label: `tts    (current: ${ttsModel})`, description: "Switch TTS voice model", value: `/model tts `, action: "complete" }
    ];
    return opts.filter((o) => !sub || o.label.includes(sub));
  }

  if (cmd === "model" && parts.length === 3 && (sub === "narr" || sub === "tts")) {
    const cap = sub === "narr" ? "narration" : "tts";
    const options: SelectionOption[] = [];
    const section = registry?.[cap];
    if (section) {
      for (const [name, entry] of Object.entries(section.providers)) {
        options.push({
          label: `${entry.model}  (${name})`,
          description: entry.baseUrl,
          value: `/model ${sub} ${entry.model}`,
          action: "submit"
        });
      }
    }
    options.push({ label: "(custom model id...)", description: "Type a different model ID", value: `/model ${sub} `, action: "complete" });
    return options;
  }

  if (cmd === "provider" && parts.length === 2) {
    const opts: SelectionOption[] = [
      { label: "list", description: "Show all configured providers", value: "/provider list", action: "submit" },
      { label: "use", description: "Switch active provider", value: "/provider use ", action: "complete" },
      { label: "test", description: "Test provider connection", value: "/provider test ", action: "complete" },
      { label: "delete", description: "Remove a provider", value: "/provider delete ", action: "complete" }
    ];
    return opts.filter((o) => !sub || o.label.startsWith(sub));
  }

  if (cmd === "provider" && parts.length === 3 && (sub === "use" || sub === "test" || sub === "delete")) {
    return [
      { label: "narration", description: "Narration/text model providers", value: `/provider ${sub} narration `, action: "complete" },
      { label: "tts", description: "TTS/voice model providers", value: `/provider ${sub} tts `, action: "complete" }
    ];
  }

  if (cmd === "provider" && parts.length === 4 && (sub === "use" || sub === "test" || sub === "delete")) {
    const cap = parts[2];
    if (!cap) return [];
    const section = registry?.[cap as "narration" | "tts"];
    if (!section) return [];
    return Object.entries(section.providers).map(([name, entry]) => ({
      label: `${name}  (${entry.model})`,
      description: section.active === name ? "active" : entry.baseUrl,
      value: `/provider ${sub} ${cap} ${name}`,
      action: "submit" as const
    }));
  }

  if (cmd === "resume" && parts.length === 2) {
    return [
      { label: "(enter session ID or path)", description: "Type a session identifier", value: "/resume ", action: "complete" }
    ];
  }

  if (cmd === "login" && parts.length === 2) {
    return [
      { label: "narration", description: "Add a text/narration model provider", value: "/login narr ", action: "complete" },
      { label: "tts", description: "Add a TTS/voice model provider", value: "/login tts ", action: "complete" }
    ];
  }

  return [];
}

function presenceBorderColor(state: PresenceState): string {
  if (state === "error") return "red";
  if (state === "warning") return "yellow";
  if (state === "speaking") return "cyan";
  if (state === "thinking") return "magenta";
  if (state === "listening") return "cyanBright";
  return "gray";
}

function presenceTextColor(state: PresenceState): string | undefined {
  if (state === "error") return "redBright";
  if (state === "warning") return "yellow";
  if (state === "speaking") return "cyanBright";
  if (state === "thinking") return "magentaBright";
  if (state === "listening") return "cyanBright";
  return "white";
}

function formatProviderList(registry: ProviderRegistry | null): string {
  if (!registry || (!registry.narration && !registry.tts)) {
    return "No providers configured. Use /login to add one, or configure via .env.";
  }
  const lines = ["=== Providers ==="];
  for (const cap of ["narration", "tts"] as const) {
    const section = registry[cap];
    if (!section) continue;
    lines.push(`\n${cap}:`);
    for (const [name, entry] of Object.entries(section.providers)) {
      const active = section.active === name ? " [active]" : "";
      lines.push(`  ${name}${active}: ${entry.model} @ ${entry.baseUrl}`);
    }
  }
  lines.push("\nUse /provider use <capability> <name> to switch.");
  return lines.join("\n");
}

function createRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
}
