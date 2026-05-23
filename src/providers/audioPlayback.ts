import { spawn } from "node:child_process";
import { extname } from "node:path";
import type { VoiceOutputResult } from "../core/types.js";

export async function playAudioFile(path: string, timeoutMs = 20_000): Promise<Pick<VoiceOutputResult, "played" | "error">> {
  if (process.platform !== "win32") {
    return { played: false, error: "Audio playback is only implemented for Windows in this build." };
  }
  if (extname(path).toLowerCase() !== ".wav") {
    return { played: false, error: "Internal playback currently supports wav only. Use SAMANTHA_TTS_OUTPUT_FORMAT=wav." };
  }

  const script = `
param([string]$AudioPath)
$path = [System.IO.Path]::GetFullPath($AudioPath)
Add-Type -AssemblyName System.Windows.Forms
$player = New-Object System.Media.SoundPlayer
$player.SoundLocation = $path
$player.Load()
$player.PlaySync()
$player.Dispose()
`;

  return await new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script, path], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ played: false, error: `Audio playback timed out after ${timeoutMs}ms.` });
    }, timeoutMs);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ played: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { played: true } : { played: false, error: stderr.trim() || `Playback exited ${code}.` });
    });
  });
}
