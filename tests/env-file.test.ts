import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFile, parseEnvFile } from "../src/config/envFile.js";

describe("env file loader", () => {
  it("parses common .env syntax", () => {
    expect(
      parseEnvFile(`
# comment
MIMO_API_KEY=secret
SAMANTHA_TTS_MODEL="mimo-v2.5-tts-voicedesign"
export SAMANTHA_TTS_OUTPUT_FORMAT=mp3 # inline comment
`)
    ).toEqual({
      MIMO_API_KEY: "secret",
      SAMANTHA_TTS_MODEL: "mimo-v2.5-tts-voicedesign",
      SAMANTHA_TTS_OUTPUT_FORMAT: "mp3"
    });
  });

  it("loads .env values without overriding existing env values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "her-samantha-env-"));
    const path = join(dir, ".env");
    await writeFile(path, "MIMO_API_KEY=from_file\nSAMANTHA_TTS_MODEL=mimo\n", "utf8");
    const env: NodeJS.ProcessEnv = {
      MIMO_API_KEY: "from_shell"
    };

    const result = await loadEnvFile(path, env);

    expect(result.loaded).toBe(true);
    expect(result.keys).toEqual(["SAMANTHA_TTS_MODEL"]);
    expect(env).toMatchObject({
      MIMO_API_KEY: "from_shell",
      SAMANTHA_TTS_MODEL: "mimo"
    });
  });

  it("does nothing when .env does not exist", async () => {
    const env: NodeJS.ProcessEnv = {};
    const result = await loadEnvFile(join(tmpdir(), "missing-her-samantha.env"), env);

    expect(result).toMatchObject({ loaded: false, keys: [] });
    expect(env).toEqual({});
  });
});
