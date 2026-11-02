# Fallback for sessions that are not in Windows Terminal:
# 1. VS Code window showing this session (editor tab title or workspace folder)
# 2. the Claude desktop app window
param([string]$Title = '', [string]$TargetCwd = '')
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFront {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

function Show-Window($p) {
    $h = $p.MainWindowHandle
    if ([WinFront]::IsIconic($h)) { [WinFront]::ShowWindow($h, 9) | Out-Null }
    [WinFront]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [WinFront]::SetForegroundWindow($h) | Out-Null
    [WinFront]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}

$vs = @(Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle })
if ($vs.Count -gt 0) {
    $match = $null
    if ($Title) {
        # VS Code truncates long editor names with an ellipsis
        $match = $vs | Where-Object {
            $name = ($_.MainWindowTitle -split ' - ')[0].TrimEnd([char]0x2026, '.', ' ')
            $name.Length -ge 8 -and $Title.StartsWith($name, [StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1
    }
    if (-not $match -and $TargetCwd) {
        $leaf = Split-Path $TargetCwd -Leaf
        $match = $vs | Where-Object { $_.MainWindowTitle -like "*- $leaf - Visual Studio Code*" -or $_.MainWindowTitle -like "*$leaf*Visual Studio Code" } | Select-Object -First 1
    }
    if ($match) { Show-Window $match; Write-Output "focused_vscode"; exit }
}

$p = Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Claude' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no_window"; exit }
Show-Window $p
Write-Output "focused_desktop"
