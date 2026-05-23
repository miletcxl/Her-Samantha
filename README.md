# Her-Samantha

> A runtime-agnostic agent shell that turns public agent work into concise narration, optional voice, and reviewable artifacts.

Her-Samantha is a Node.js CLI/TUI for working with agent runtimes through a single interface. Pi is the first runtime adapter; the architecture is intentionally shaped so Codex, Claude, and other agents can sit behind the same boundary later.

## Highlights

- **Unified agent shell**: interact with Pi through Her-Samantha's own TUI instead of embedding Pi's native TUI.
- **Narration layer**: convert normalized public runtime traces into `spokenSummary`, structured detail, final answer, and risk notes.
- **Voice without leaking detail**: TTS receives only `spokenSummary`, never raw traces, stack traces, private reasoning, or full detail.
- **Offline-first tests**: CI uses mock providers, fake runtime paths, and recorded trace fixtures; real Pi and real APIs are manual smoke tests.
- **Artifacts on demand**: reports, normalized traces, and audio are written only when `--save-artifacts` is used.

## Status

This project is early. The offline path, mock providers, OpenAI-compatible narration boundary, Mimo TTS boundary, Pi RPC adapter, and Ink TUI shell are implemented. Pi is the only real runtime currently wired into the TUI.

## Quick Start

```bash
npm install
npm run build
node dist/cli.js run offline examples/letters_task.json --narration-provider mock --tts mock --voice --save-artifacts
```

You should see a spoken summary in the terminal and an artifact directory under `output/`.

## TUI

Start the Samantha shell:

```bash
node dist/cli.js tui
```

The TUI has two zones:

- **Left**: the working conversation with Samantha and the hidden runtime agent.
- **Right**: Samantha's presence panel with voice state, folded Summary / Detail / Final Answer / Risk sections, and model status.

Useful commands inside the TUI:

```text
/help
/voice on
/voice off
/voice test
/voice debug
/model
/provider list
/session
/final
/clear
/exit
```

The default command is Pi TUI. This is equivalent:

```bash
node dist/cli.js tui pi
```

Text-only TUI:

```bash
node dist/cli.js tui --no-voice
```

## CLI Usage

Run an offline recorded trace:

```bash
node dist/cli.js run offline examples/letters_task.json --narration-provider mock --tts mock --no-voice
```

Run the offline path and save artifacts:

```bash
node dist/cli.js run offline examples/letters_task.json --narration-provider mock --tts mock --voice --save-artifacts
```

Run one Pi task through the non-interactive shell:

```bash
node dist/cli.js listen pi --pi-real --pi-timeout-ms 120000 --task "Summarize this project." --narration-provider mock --tts mock --no-voice
```

Check local provider and Pi configuration:

```bash
node dist/cli.js doctor
```

## Configuration

Her-Samantha loads `.env` and `.samantha/.env.local` locally. Do not commit either file.

Use `.env.example` as a template. API keys are referenced by environment variable name rather than passed directly through commands.

Minimum Pi-related variables:

```env
SAMANTHA_PI_PATH=C:\path\to\pi.exe
SAMANTHA_PI_PROVIDER=xiaomi-token-plan-cn
SAMANTHA_PI_MODEL=mimo-v2.5-pro
SAMANTHA_PI_TIMEOUT_MS=120000
```

OpenAI-compatible narration:

```env
SAMANTHA_NARRATION_BASE_URL=https://example.com/v1
SAMANTHA_NARRATION_MODEL=your-chat-model
SAMANTHA_NARRATION_API_KEY_ENV=YOUR_API_KEY_ENV_NAME
```

Mimo TTS:

```env
SAMANTHA_TTS_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
SAMANTHA_TTS_MODEL=mimo-v2.5-tts-voicedesign
SAMANTHA_TTS_VOICE_DESCRIPTION=warm natural restrained Chinese female assistant voice
SAMANTHA_TTS_API_KEY_ENV=MIMO_API_KEY
SAMANTHA_TTS_OUTPUT_FORMAT=mp3
```

For local provider profiles, the TUI can write `.samantha/providers.json` and `.samantha/.env.local` through `/login` and provider commands.

## How It Works

```text
Runtime agent
  -> AgentRuntimeAdapter
  -> normalized public trace
  -> NarrationResult
  -> optional TTS
  -> optional artifacts
```

Core boundaries:

- `AgentRuntimeAdapter` owns runtime-specific execution.
- `RuntimeCapabilities` describes what a runtime can actually expose.
- Narration providers receive public trace input and return a `NarrationResult`.
- TTS providers receive only `spokenSummary`.
- Artifact writing is opt-in.

## Runtime Support

| Runtime | Status | Boundary |
|---|---:|---|
| Offline JSON trace | implemented | recorded fixture replay |
| Pi | implemented | RPC mode for TUI, JSON print fallback for one-shot smoke tests |
| Codex | planned | adapter not implemented |
| Claude | planned | adapter not implemented |
| Hermes / OpenClaw | planned | adapter not implemented |

Her-Samantha does not parse native runtime TUIs. Runtime integrations should use the most stable machine-readable boundary each runtime exposes.

## Providers

| Capability | Provider | Status |
|---|---:|---|
| Narration | mock | implemented |
| Narration | OpenAI-compatible chat completions | implemented |
| TTS | mock WAV | implemented |
| TTS | Mimo chat-completions audio | implemented |

Real provider calls are not required for tests.

## Artifacts

Artifacts are disabled by default. With `--save-artifacts`, Her-Samantha writes:

```text
output/<timestamp>-<runId>/
  report.md
  report.json
  trace.normalized.json
  samantha_summary.<format>
```

Raw runtime events are not saved by default.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The test suite must stay independent from real Pi, real API keys, real TTS services, and network access.

## Project Layout

```text
src/
  core/          shared types, event bus, session orchestration
  runtimes/      offline and Pi runtime adapters
  providers/     narration, TTS, provider registry, audio playback
  narration/     fallback, validation, spoken-summary policy checks
  artifacts/     report and trace writer
  renderer/      terminal summary renderer
  tui/           Ink TUI
tests/           unit and integration tests with mocks/fakes
examples/        offline trace fixtures
```

## Privacy And Safety

Her-Samantha should not display or store:

- private chain-of-thought
- raw tool logs by default
- API keys
- full environment variables
- hidden runtime reasoning

TTS must only receive `spokenSummary`.

## Roadmap

- Harden Pi RPC permission prompts and session restore flows.
- Improve TUI interaction quality: command palette, model/profile switching, and smoother cancellation.
- Add explicit fake Pi integration coverage for long sessions.
- Add Codex and Claude adapters when their stable machine-readable boundaries are confirmed.
- Publish as the `her-samantha` npm package with `samantha` as the bin command.

## License

MIT
