# Her-Samantha

Her-Samantha is a Node.js CLI/TUI shell that wraps agent runtimes with concise summaries, optional voice output, and local artifacts.

## Current capabilities

- Run an offline recorded trace fixture.
- Run Pi through a long-lived RPC runtime adapter for TUI sessions.
- Normalize runtime events into a public trace.
- Generate narration with a mock provider or an OpenAI-compatible chat completions provider.
- Generate voice with a mock TTS provider or a configured TTS provider.
- Save optional artifacts: report markdown, report JSON, normalized trace, and audio.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Example

```bash
node dist/cli.js run offline examples/letters_task.json --narration-provider mock --tts mock --voice --save-artifacts
```

Run Pi once through Her-Samantha's non-interactive shell:

```bash
node dist/cli.js listen pi --pi-real --pi-timeout-ms 120000 --task "Summarize this project." --narration-provider mock --tts mock --no-voice --save-artifacts
```

Start the Pi harness TUI. Voice is on by default in TUI; use `--no-voice` for text-only:

```bash
node dist/cli.js tui pi --pi-timeout-ms 120000 --tts mock --no-voice
node dist/cli.js tui pi --pi-session-dir "$env:USERPROFILE\.pi\agent\sessions" --pi-continue --tts mimo
```

Inside the TUI, use `/help` for shell commands. The first supported commands are `/voice`, `/model`, `/provider`, `/session`, `/resume`, `/save`, `/clear`, and `/exit`.

For real providers, configure credentials through local environment variables. Do not commit local `.env` files.
