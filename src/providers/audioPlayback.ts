import { spawn } from "node:child_process";
import { extname } from "node:path";
import type { VoiceOutputResult } from "../core/types.js";

export interface BackgroundAudioResult {
  started: boolean;
  error?: string;
}

export async function playAudioFile(
  path: string,
  timeoutMs = 20_000,
  signal?: AbortSignal
): Promise<Pick<VoiceOutputResult, "played" | "error">> {
  const validation = validatePlayablePath(path);
  if (validation) return { played: false, error: validation };
  if (signal?.aborted) return { played: false, error: "Audio playback cancelled." };

  return await new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodePowerShell(createSoundPlayerScript(path))], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    let settled = false;
    const settle = (result: Pick<VoiceOutputResult, "played" | "error">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => {
      child.kill();
      settle({ played: false, error: "Audio playback cancelled." });
    };
    const timer = setTimeout(() => {
      child.kill();
      settle({ played: false, error: `Audio playback timed out after ${timeoutMs}ms.` });
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      settle({ played: false, error: error.message });
    });
    child.on("close", (code) => {
      settle(code === 0 ? { played: true } : { played: false, error: stderr.trim() || `Playback exited ${code}.` });
    });
  });
}

export async function startAudioPlaybackInBackground(path: string): Promise<BackgroundAudioResult> {
  const validation = validatePlayablePath(path);
  if (validation) return { started: false, error: validation };

  return await new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodePowerShell(createSoundPlayerScript(path))], {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    let resolved = false;
    const settle = (result: BackgroundAudioResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => settle({ started: false, error: error.message }));
    child.once("spawn", () => {
      setTimeout(() => {
        child.unref();
        settle({ started: true });
      }, 1000);
    });
    child.once("close", (code) => {
      if (resolved) return;
      settle(code === 0 ? { started: true } : { started: false, error: stderr.trim() || `Playback exited ${code}.` });
    });
  });
}

function validatePlayablePath(path: string): string | undefined {
  if (process.platform !== "win32") {
    return "Audio playback is only implemented for Windows in this build.";
  }
  const extension = extname(path).toLowerCase();
  if (extension !== ".wav" && extension !== ".mp3") {
    return "Internal playback currently supports wav and mp3 only.";
  }
  return undefined;
}

function createSoundPlayerScript(path: string): string {
  const literalPath = path.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = [System.IO.Path]::GetFullPath('${literalPath}')
Add-Type -AssemblyName System
if ([System.IO.Path]::GetExtension($path).ToLowerInvariant() -eq '.wav') {
  $sound = New-Object System.Media.SoundPlayer
  $sound.SoundLocation = $path
  $sound.Load()
  $sound.PlaySync()
  $sound.Dispose()
  exit 0
}
Add-Type -AssemblyName PresentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$opened = $false
$failed = $false
$player.add_MediaOpened({ $script:opened = $true })
$player.add_MediaFailed({ $script:failed = $true; Write-Error $_.ErrorException.Message })
$player.Open([Uri]::new($path))
$waitUntil = [DateTime]::UtcNow.AddSeconds(5)
while (-not $opened -and -not $failed -and [DateTime]::UtcNow -lt $waitUntil) {
  Start-Sleep -Milliseconds 50
}
if ($failed -or -not $opened) {
  throw "MediaPlayer could not open audio."
}
$duration = 8000
if ($player.NaturalDuration.HasTimeSpan) {
  $duration = [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds + 500
}
$player.Play()
Start-Sleep -Milliseconds ([Math]::Min([Math]::Max($duration, 1200), 60000))
$player.Close()
`;
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
