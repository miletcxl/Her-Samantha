# Her-Samantha

Her-Samantha is a Node.js CLI that turns agent execution traces into concise text summaries, optional voice output, and local artifacts.

## Current capabilities

- Run an offline recorded trace fixture.
- Run Pi in JSON print mode through a runtime adapter.
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

For real providers, configure credentials through local environment variables. Do not commit local `.env` files.
