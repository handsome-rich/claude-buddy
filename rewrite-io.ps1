# Reads the text to rewrite: the selection of the foreground app, or the clipboard when nothing is selected.
# Prints base64(UTF-8 JSON): { selected, text }. Run with -STA.
# The user's clipboard text is restored afterwards.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System.Runtime.InteropServices;
public class RwKeys {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
    // True while Ctrl, Alt, Shift or Win is held down
    public static bool ModifiersDown() {
        foreach (int vk in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if ((GetAsyncKeyState(vk) & 0x8000) != 0) return true;
        return false;
    }
}
"@

# Another program (clipboard manager) can hold the clipboard for a moment, so retry
function Clip-Retry([scriptblock]$op) {
  for ($i = 0; $i -lt 15; $i++) {
    try { return (& $op) } catch { if ($i -eq 14) { throw }; Start-Sleep -Milliseconds 100 }
  }
}
function Get-ClipText {
  Clip-Retry { if ([Windows.Forms.Clipboard]::ContainsText()) { [Windows.Forms.Clipboard]::GetText() } else { $null } }
}
function Set-ClipText($t) {
  Clip-Retry { if ($null -ne $t) { [Windows.Forms.Clipboard]::SetText($t) } else { [Windows.Forms.Clipboard]::Clear() } } | Out-Null
}

try {
  $orig = Get-ClipText
  # The hotkey fires while its keys are still down. SendKeys would add them to Ctrl+C.
  $until = (Get-Date).AddSeconds(2)
  while ([RwKeys]::ModifiersDown() -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 30 }

  # Ctrl+C in a terminal would interrupt the running program, so terminals only use the clipboard
  $fgPid = [uint32]0
  [void][RwKeys]::GetWindowThreadProcessId([RwKeys]::GetForegroundWindow(), [ref]$fgPid)
  $fgName = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName
  if ($fgName -match '^(WindowsTerminal|wt|powershell|pwsh|cmd|conhost|OpenConsole|alacritty|wezterm-gui|mintty)$') {
    $json = @{ selected = $false; text = $orig } | ConvertTo-Json -Compress
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    return
  }

  $sentinel = '__buddy_' + [guid]::NewGuid().ToString('N') + '__'
  Set-ClipText $sentinel
  [Windows.Forms.SendKeys]::SendWait('^c')
  $got = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 40
    $t = Get-ClipText
    if ($t -and $t -ne $sentinel) { $got = $t; break }
  }
  Set-ClipText $orig
  $selected = $null -ne $got
  $json = @{ selected = $selected; text = $(if ($selected) { $got } else { $orig }) } | ConvertTo-Json -Compress
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
} catch {
  Write-Output ('error:' + $_.Exception.Message)
}
