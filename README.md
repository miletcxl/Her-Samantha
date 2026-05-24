# Her-Samantha

<p align="center">
  <em>A voice and narration layer for the agents you already run in the terminal.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" />
  <img src="https://img.shields.io/badge/runtime-Pi-blue" />
  <img src="https://img.shields.io/badge/TUI-Ink-cyan" />
  <img src="https://img.shields.io/badge/license-MIT-black" />
</p>

<p align="center">
  <img src="./asset/figure/samantha.png" alt="Her-Samantha" width="80%" />
</p>

---

## What is this?

**Her-Samantha is not another agent runtime.** It does not replace Pi, Claude Code, or Codex. It is a presentation layer that sits in front of them.

When a terminal agent runs a task — reading files, calling tools, producing partial output — the work appears as a stream of logs, tool calls, and raw text. That stream is hard to follow at a glance, impossible to speak aloud safely, and leaves no structured record unless you save it yourself.

Her-Samantha watches the **public trace** of that work, folds it into a concise spoken summary, keeps the details accessible when you need them, and can speak only the safe part aloud.

| Her-Samantha is | Her-Samantha is not |
|---|---|
| A narration and voice layer around agents | A new agent runtime |
| A shell that presents agent work cleanly | A replacement for Pi, Claude, or Codex |
| A boundary that separates private reasoning from public output | A generic TTS wrapper or log reader |
| A structured review surface after each task | A "better" agent |

## A concrete example

You ask an agent to read four letters and pick the most moving one. Without Samantha:

- The terminal fills with `read_file` tool calls, file paths, partial summaries, and a final paragraph buried in the middle.
- There is no structured record of which letter was chosen, or why.
- If you want to hear the result spoken, the entire trace — paths, reasoning, tool output — reaches the voice layer.

With Samantha:

1. The agent does the same work. The raw trace stays internal.
2. Samantha produces: `"我已经读完这些信件。最后选了第三封——它最打动人的地方不是措辞强烈，而是克制里的真诚和遗憾。更具体的比较我放在文字详情里。"`
3. Only that `spokenSummary` reaches the voice layer. The details — file-by-file analysis, selection reasoning, tool call counts — sit in a structured `textDetail` panel you can expand.
4. If you ran with `--save-artifacts`, a `report.json`, `report.md`, normalized trace, and audio file are written to disk.

## Why *Her*?

The name borrows the mood, not the plot.

In the film, Samantha translates computation into something a person can follow. This project does the same for agent work: it turns noisy execution into a clear, calm, reviewable narration. The runtime is the engine. Samantha is the presence.

<p align="center">
  <img src="./asset/figure/film.png" alt="Her film mood" width="50%" />
</p>

## Quick Start

```bash
npm install && npm run build
node dist/cli.js tui
```

Type `/` to see all commands, or just start chatting with the agent.

```bash
# Run the letters demo with mock providers (no API keys)
node dist/cli.js run offline asset/examples/letters_task.json --narration-provider mock --tts mock --voice --save-artifacts

# One-shot Pi task
node dist/cli.js listen pi --pi-real --task "Summarize this project."
```

---

## How it works

```
User
  └─ Her-Samantha TUI / CLI
       └─ AgentRuntimeAdapter (Pi today; Codex, Claude planned)
            └─ Normalized public trace (private reasoning stripped)
                 └─ Narration Layer → spokenSummary + textDetail + riskNote
                      ├─ TTS (spokenSummary only — never raw trace)
                      └─ Artifacts (opt-in: report.md, report.json, trace, audio)
```

| Layer | What it does |
|---|---|
| Runtime Adapter | Owns agent-specific execution. Pi uses RPC mode. |
| Trace Normalizer | Strips private chain-of-thought, shapes public events. |
| Narration | Produces spokenSummary (voice-safe, ~150 chars) + textDetail (structured, expandable). |
| Voice / TTS | Synthesizes `spokenSummary` only. Never receives paths, JSON, stack traces, or tool logs. |
| Artifacts | Writes `report.md`, `report.json`, normalized trace, and audio when `--save-artifacts` is set. |
| TUI | Two-zone Ink interface: left = conversation, right = Samantha panel with status + folded detail. |

---

## TUI

<p align="center">
  <img src="./asset/figure/idle.png" alt="Samantha TUI idle" width="80%" />
</p>

<p align="center">
  <img src="./asset/figure/thinking.png" alt="Samantha TUI processing" width="80%" />
</p>

<p align="center">
  <img src="./asset/figure/speaking.png" alt="Samantha TUI speaking" width="80%" />
</p>

<p align="center">
  <img src="./asset/figure/process.png" alt="Samantha TUI working" width="80%" />
</p>

**Left panel:** conversation with Samantha. Type tasks, see agent replies, watch Samantha narrate.

**Right panel:** voice status indicator, signal body visualization, folded Summary / Detail / Final Answer / Risk sections, live model display.

### Commands

| Command | |
|---|---|
| `/model narr <id>` | Switch narration model |
| `/model tts <id>` | Switch TTS model |
| `/model agent <id>` | Switch agent model (restarts Pi) |
| `/login` | Add a new model provider (wizard) |
| `/login narr <name> <url> <model> <key>` | Add a provider in one line |
| `/provider list` | Show all configured providers |
| `/provider use narration <name>` | Switch active provider |
| `/voice on\|off\|test` | Voice control |
| `/clear` | Clear the conversation |
| `/help` | Show all commands |

---

## What reaches the voice layer?

The privacy boundary is the core idea:

```
Public trace (agent work)
  → Narration extracts spokenSummary
  → TTS receives ONLY spokenSummary
  → Artifacts save trace + summary (opt-in only)
```

| Never exposed to voice | Never saved by default |
|---|---|
| Private chain-of-thought | Raw runtime events |
| Tool call logs and paths | Full agent output |
| Stack traces and error codes | API keys or env vars |
| Structured textDetail | Audio files |

---

## Runtime support

| Runtime | Status | Boundary |
|---|---|---|
| Offline JSON trace | Implemented | Recorded fixture replay |
| Pi | Implemented | RPC mode for TUI, JSON print for one-shot |
| Codex | Planned | Adapter not built |
| Claude | Planned | Adapter not built |

## Providers

| Capability | Provider | Status |
|---|---|---|
| Narration | OpenAI-compatible chat | Implemented |
| Narration | Mock (deterministic) | Implemented |
| TTS | Mimo chat-completions audio | Implemented |
| TTS | Mock WAV | Implemented |

Manage providers with `/login` and `/provider` in the TUI. Config stored in `.samantha/providers.json`. Secrets in `.samantha/.env.local` (gitignored).

---

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (mocks only — no Pi, no keys, no network)
npm run build       # tsc
```

```
src/
  core/          types, events, session orchestration
  runtimes/      Pi and offline adapters
  providers/     narration, TTS, registry, audio
  narration/     fallback, validation, policy
  artifacts/     report and trace writer
  renderer/      terminal summary output
  tui/           Ink TUI shell
  cli.ts         entry point
tests/
asset/
  examples/      offline trace fixtures
  figure/        screenshots
.samantha/       agent persona, narration policy, provider registry
```

---

<details>
<summary><strong>中文版</strong></summary>

<br>

## 这是什么？

**Her-Samantha 不是一个新的 agent 运行时。** 它不替代 Pi、Claude Code 或 Codex。它是运行在这些 agent 前面的一个展示层。

终端 agent 执行任务时——读文件、调工具、产生中间输出——整个过程看起来是一串日志、工具调用和原始文本。这串输出很难快速理解、不能安全地朗读、也不会留下结构化记录。

Her-Samantha 监控 agent 的**公开执行轨迹**，把它折叠成简洁的口语摘要，把细节保留在可展开的面板里，只把安全的部分读出来。

## 具体场景

你让 agent 读四封信，挑出最动人的一封。没有 Samantha：终端全是 `read_file` 调用、路径、片段分析，最终结论埋在中间。有 Samantha：agent 做同样的工作，但你只会听到「选了第三封——最打动人的是克制里的真诚」，详细对比留在 textDetail 里可随时展开。

## 为什么叫 Her-Samantha？

借电影的 mood，不借电影的 plot。电影里 Samantha 把计算翻译成人能懂的东西，这个项目把 agent 的嘈杂执行翻译成清晰、沉稳、可回顾的叙述。

## 快速开始

```bash
npm install && npm run build
node dist/cli.js tui
```

输入 `/` 看所有命令，或直接开始对话。

## 架构

用户 → TUI/CLI → AgentRuntimeAdapter → 归一化公开 trace → 叙述层（spokenSummary + textDetail + riskNote）→ TTS（仅用 spokenSummary）/ Artifacts（按需）

## 什么会到达语音层？

- TTS 只接收 `spokenSummary`，不收原始 trace、tool log、stack trace、API key
- 私有思维链永不暴露
- 产物写入必须显式开启 `--save-artifacts`

## 运行时支持

离线 JSON trace（已实现）、Pi RPC（已实现）、Codex/Claude（规划中）

## TUI 命令

`/model narr|tts|agent <id>` 切换模型 · `/login` 新增服务商 · `/provider list|use` 管理服务商 · `/voice on|off|test` 语音控制 · `/clear` · `/help`

## 开发

```bash
npm run typecheck && npm test && npm run build
```

CI 只用 mock，不依赖真实 Pi、API key 或网络。

</details>

---

## License

MIT
