# AGENTS.md

## Project Identity

Her-Samantha is a runtime-agnostic Agent Shell and narration/voice layer. It wraps runtime agents (Pi, eventually Codex, Claude, etc.) and produces spoken summaries, structured detail, and optional voice output.

It is NOT a Pi-only wrapper. Pi is the first reference runtime.

## Core Pipeline

```
Runtime events
  → normalized public trace
  → NarrationResult (spokenSummary + textDetail + riskNote)
  → optional TTS voice synthesis
  → optional artifact writes
```

## Engineering Boundaries

Do NOT turn Her-Samantha into:
- a generic TTS wrapper
- a raw log viewer
- a full personal AI system
- a Pi fork or Pi-only tool
- a Claude/Codex native TUI embedding layer

Her-Samantha owns its own UI/TUI. Runtime agents run behind `AgentRuntimeAdapter` (`src/core/types.ts`).

## Runtime Adapter Rules

All runtime integrations go through `AgentRuntimeAdapter` (`src/core/types.ts:96`). Do NOT hard-code Pi-specific concepts into core types or session logic.

Pi runtime (`src/runtimes/pi.ts`):
- Prefer RPC mode for long-running TUI sessions
- `--mode json` is the fallback parse mode
- Do NOT parse Pi native TUI output
- Do NOT expose private reasoning or thinking events

Future runtimes (Codex, Claude, Hermes, OpenClaw):
- Use `RuntimeCapabilities` (`src/core/types.ts:83`) to describe what each runtime supports
- Not all runtimes expose the same capabilities as Pi

## Narration Rules

Narration is NOT log summarization. It converts public execution traces into concise, human-friendly spoken updates.

`spokenSummary`:
- Short, conversational, suitable for TTS
- No file paths, no JSON, no stack traces, no raw tool logs
- No private chain-of-thought

`textDetail`:
- Structured and traceable
- Can include filenames, selected items, reasons, warnings, final answer references

TTS must ONLY receive `spokenSummary`, never full detail.

Narration providers are in `src/providers/`:
- `mockNarration.ts` — deterministic mock for tests and offline replay
- `openaiCompatibleNarration.ts` — calls an OpenAI-compatible API with structured prompt

## TUI Design (`src/tui/`)

Two-zone layout:
- **Left**: agent interaction, user messages, runtime replies, input area
- **Right**: Samantha presence panel — voiceprint/signal body, status, folded Summary/Detail/Final/Risk sections

Do NOT dump raw trace or full detail objects into the right panel by default.

## Testing Rules

CI must NOT depend on:
- Real Pi binary
- Real API keys (MiMo, OpenAI, etc.)
- Real network calls

Use fake Pi RPC, mock narration (`createMockNarration`), and mock TTS (`synthesizeMockTts`) in tests.

Real Pi and real TTS are manual smoke tests only.

## Security and Privacy

Never store or display:
- Private chain-of-thought
- API keys
- Full environment variables
- Hidden runtime reasoning
- Raw events (by default)

Artifacts are opt-in only via `--save-artifacts`.

## Key Files

| File | Role |
|---|---|
| `src/core/types.ts` | All shared types |
| `src/core/session.ts` | Session orchestration and pipeline |
| `src/core/events.ts` | EventBus |
| `src/providers/config.ts` | Env-based provider config |
| `src/runtimes/pi.ts` | Pi runtime adapter |
| `src/runtimes/offline.ts` | Offline trace replay |
| `src/tui/SamanthaTui.tsx` | Ink TUI |
| `src/cli.ts` | CLI entry point |
