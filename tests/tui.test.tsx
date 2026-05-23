import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { SamanthaTui } from "../src/tui/SamanthaTui.js";
import { parseTuiSlashCommand, TUI_COMMANDS } from "../src/tui/commands.js";

describe("Samantha TUI", () => {
  it("renders the unified Pi shell without private reasoning", () => {
    const { lastFrame } = render(
      <SamanthaTui
        runtime="pi"
        voice={false}
        ttsProvider="mock"
        narrationProvider="mock"
        saveArtifacts={false}
        outDir="output"
      />
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Her-Samantha Pi Harness");
    expect(frame).toContain("pi v0.75.x");
    expect(frame).toContain("Samantha");
    expect(frame).toContain("Summary");
    expect(frame).toContain("Harness");
    expect(frame).not.toContain("private reasoning");
    expect(frame).not.toContain("thinking");
  });

  it("parses shell slash commands", () => {
    expect(parseTuiSlashCommand("/voice off")).toEqual({ type: "voice", enabled: false });
    expect(parseTuiSlashCommand("/voice test")).toEqual({ type: "voice", test: true });
    expect(parseTuiSlashCommand("/model mimo-v2.5-pro")).toEqual({ type: "model", value: "mimo-v2.5-pro" });
    expect(parseTuiSlashCommand("/login")).toEqual({ type: "login" });
    expect(parseTuiSlashCommand("/provider list")).toEqual({ type: "provider", action: "list" });
    expect(parseTuiSlashCommand("/provider use narration deepseek")).toEqual({
      type: "provider", action: "use", capability: "narration", providerName: "deepseek"
    });
    expect(parseTuiSlashCommand("/provider test tts mimo")).toEqual({
      type: "provider", action: "test", capability: "tts", providerName: "mimo"
    });
    expect(parseTuiSlashCommand("/provider delete narration deepseek")).toEqual({
      type: "provider", action: "delete", capability: "narration", providerName: "deepseek"
    });
    expect(parseTuiSlashCommand("/session")).toEqual({ type: "session" });
    expect(parseTuiSlashCommand("/resume abc")).toEqual({ type: "resume", value: "abc" });
    expect(parseTuiSlashCommand("/save")).toEqual({ type: "save" });
    expect(parseTuiSlashCommand("/clear")).toEqual({ type: "clear" });
    expect(parseTuiSlashCommand("/help")).toEqual({ type: "help" });
    expect(parseTuiSlashCommand("/exit")).toEqual({ type: "exit" });
    expect(TUI_COMMANDS).toContain("/model");
    expect(TUI_COMMANDS).toContain("/voice test");
  });
});
