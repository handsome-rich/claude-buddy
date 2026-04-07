param([string]$SessionId, [string]$TargetCwd)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

# Step 1: Find the transcript file for this session
$transcriptBase = Join-Path $env:USERPROFILE ".claude\projects"
$transcriptFile = Get-ChildItem -Path $transcriptBase -Recurse -Filter "$SessionId.jsonl" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $transcriptFile) { Write-Output "no_transcript"; exit }

# Step 2: Find which claude.exe has this file open by trying to lock it
# then check each claude's file handles
$allProcs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$claudes = $allProcs | Where-Object { $_.Name -eq 'claude.exe' }

# Step 3: Match claude to shell PID
# Strategy: each claude writes to ONE transcript file.
# The transcript dir name encodes the cwd: D:\foo\bar -> D--foo-bar
# We know the target cwd. The transcript dir should match.
$transcriptDirName = $transcriptFile.Directory.Name
# e.g. "D--Auto-claude-code-research-in-sleep-project-tools"

# Build expected dir name from cwd
$expectedDirName = $TargetCwd.Replace('\', '-').Replace(':', '')
# e.g. "D--Auto-claude-code-research-in-sleep-project-tools"

# Step 4: We need to find which claude process is in this directory.
# Since all claudes look identical, we use a trick:
# Try to open the transcript file exclusively. It will fail because one claude has it locked.
# Then, for each claude, kill it temporarily... NO, that's destructive.
#
# Better approach: use the transcript file's last write time.
# The active session's transcript is being written to right now.
# Each claude has a unique parent shell PID.
# We just need to figure out which claude maps to this session.
#
# Simplest reliable approach: check the transcript file's LAST WRITE TIME
# against each claude's START TIME. The claude that started closest to
# (but before) the transcript's creation time is our match.

$transcriptCreated = $transcriptFile.CreationTime
$bestMatch = $null
$bestDiff = [TimeSpan]::MaxValue

foreach ($c in $claudes) {
    $proc = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
    if ($proc) {
        $diff = $transcriptCreated - $proc.StartTime
        if ($diff -ge [TimeSpan]::Zero -and $diff -lt $bestDiff) {
            $bestDiff = $diff
            $bestMatch = $c
        }
    }
}

if (-not $bestMatch) {
    # Fallback: if transcript was created before all claudes (session resume),
    # match by checking which claude's start time is closest to transcript's last write
    foreach ($c in $claudes) {
        $proc = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
        if ($proc) {
            $diff = [Math]::Abs(($transcriptFile.LastWriteTime - $proc.StartTime).TotalSeconds)
            if ($diff -lt $bestDiff.TotalSeconds) {
                $bestDiff = [TimeSpan]::FromSeconds($diff)
                $bestMatch = $c
            }
        }
    }
}

if (-not $bestMatch) { Write-Output "no_claude_match"; exit }

$targetShellPid = $bestMatch.ParentProcessId

# Step 5: Map shell PID to tab index
$wtProc = $allProcs | Where-Object { $_.Name -eq 'WindowsTerminal.exe' } | Select-Object -First 1
if (-not $wtProc) { Write-Output "no_wt"; exit }

$shells = $allProcs | Where-Object {
    $_.ParentProcessId -eq $wtProc.ProcessId -and $_.Name -match 'powershell|pwsh|cmd|bash'
} | Sort-Object ProcessId

$tabIndex = -1
for ($i = 0; $i -lt $shells.Count; $i++) {
    if ($shells[$i].ProcessId -eq $targetShellPid) {
        $tabIndex = $i
        break
    }
}

if ($tabIndex -eq -1) { Write-Output "shell_not_in_wt"; exit }

# Step 6: Find tabs via UI Automation and select the right one
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wtCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$wtWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $wtCondition)

$allTabs = @()
$tabWindowList = @()
foreach ($wt in $wtWindows) {
    $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $wt.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    foreach ($tab in $tabs) {
        $allTabs += $tab
        $tabWindowList += $wt
    }
}

if ($tabIndex -ge $allTabs.Count) { Write-Output "tab_oob"; exit }

$targetTab = $allTabs[$tabIndex]
$targetWindow = $tabWindowList[$tabIndex]
$hwnd = [IntPtr]$targetWindow.Current.NativeWindowHandle

if ([WinFocus]::IsIconic($hwnd)) { [void][WinFocus]::ShowWindow($hwnd, 9) }
[WinFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[void][WinFocus]::SetForegroundWindow($hwnd)
[WinFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)

try {
    $pattern = $targetTab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $pattern.Select()
} catch {}

Write-Output "focused_tab_$tabIndex"
