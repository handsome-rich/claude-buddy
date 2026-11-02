# Sends a prompt to the Claude desktop app without touching the foreground: no focus change,
# no keystrokes, no clipboard. It drives the app through UI Automation, so the window can stay
# minimized or behind other windows.
#   default         -> new chat
#   -ChatTitle X    -> the sidebar chat titled X (it stays in the recent chats while it is used)
# Prints: sent | no_desktop_window | no_chat | error:<msg>
param(
  [Parameter(Mandatory)][string]$TextFile,
  [string]$ChatTitle = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

try {
  $text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
  $p = Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Claude' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { Write-Output 'no_desktop_window'; exit }

  $AE = [Windows.Automation.AutomationElement]
  $TS = [Windows.Automation.TreeScope]
  $BUTTON = [Windows.Automation.ControlType]::Button
  $EDIT = [Windows.Automation.ControlType]::Edit
  $RADIO = [Windows.Automation.ControlType]::RadioButton
  $root = $AE::FromHandle($p.MainWindowHandle)

  function Find-Named($name, $type) {
    $c = New-Object Windows.Automation.AndCondition(
      (New-Object Windows.Automation.PropertyCondition($AE::NameProperty, $name)),
      (New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)))
    $root.FindFirst($TS::Descendants, $c)
  }
  # Elements appear a moment after a page change, so wait for them
  function Wait-Named($name, $type, $seconds = 12) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
      $e = Find-Named $name $type
      if ($e) { return $e }
      Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $until)
    return $null
  }
  function Invoke-El($e) { $e.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
  function Box-Text {
    $b = Find-Named 'Write your prompt to Claude' $EDIT
    if (-not $b) { return '' }
    return $b.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
  }

  # The app has Chat and Code modes. Selecting the active mode can reset the page, so switch only when needed.
  $mode = Find-Named 'Chat and Cowork' $RADIO
  if ($mode) {
    $sel = $mode.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
    if (-not $sel.Current.IsSelected) {
      $sel.Select()
      Start-Sleep -Milliseconds 1500
    }
  }

  if ($ChatTitle) {
    # Sidebar chat button names are the title, sometimes with a status prefix ("Idle ", "Mark as unread ")
    $chat = $null
    $until = (Get-Date).AddSeconds(5)
    do {
      $btnType = New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $BUTTON)
      foreach ($b in $root.FindAll($TS::Descendants, $btnType)) {
        $n = $b.Current.Name
        if ($b.Current.BoundingRectangle.Left -lt 320 -and ($n -eq $ChatTitle -or $n.EndsWith(' ' + $ChatTitle)) -and -not $n.StartsWith('More options')) { $chat = $b; break }
      }
      if (-not $chat) { Start-Sleep -Milliseconds 300 }
    } while (-not $chat -and (Get-Date) -lt $until)
    if (-not $chat) { Write-Output 'no_chat'; exit }
    # The chat header holds a "<title>, rename chat" button. Reopening the chat that is already open
    # re-renders the page late and can wipe the text we set, so only click when it is not open.
    function Header-Open { return [bool](Find-Named "$ChatTitle, rename chat" $BUTTON) }
    if (-not (Header-Open)) {
      Invoke-El $chat
      $until = (Get-Date).AddSeconds(12)
      while (-not (Header-Open) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 250 }
      Start-Sleep -Milliseconds 800
    }
  } else {
    $new = Find-Named 'New' $BUTTON
    if (-not $new) { throw 'New button not found' }
    Invoke-El $new
    Start-Sleep -Milliseconds 1000
  }

  $box = Wait-Named 'Write your prompt to Claude' $EDIT
  if (-not $box) { throw 'prompt box not found' }

  # A minimized window renders late, so the box can look unchanged after sending. Confirm by counting
  # how many messages contain the end of the draft: it must go up by one.
  # Text elements are named by paragraph, so match the last line exactly (UI Automation filters, which is fast)
  $snippet = (($text.Trim() -split "`n")[-1]).Trim()
  function Count-Snippet {
    $cond = New-Object Windows.Automation.AndCondition(
      (New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::Text)),
      (New-Object Windows.Automation.PropertyCondition($AE::NameProperty, $snippet)))
    $n = 0
    foreach ($e in $root.FindAll($TS::Descendants, $cond)) {
      # Skip the draft text inside the prompt box itself
      $inBox = $false
      $up = [Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($e)
      for ($i = 0; $i -lt 8 -and $up; $i++) {
        if ($up.Current.ControlType -eq $EDIT) { $inBox = $true; break }
        $up = [Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($up)
      }
      if (-not $inBox) { $n++ }
    }
    return $n
  }
  $before = Count-Snippet

  # The send button appears once the app has registered the text. A late re-render can drop the text, so retry.
  $send = $null
  for ($try = 0; $try -lt 3 -and -not $send; $try++) {
    $box = Wait-Named 'Write your prompt to Claude' $EDIT
    if ($box) { $box.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($text) }
    # A minimized window renders slowly: the button can take about 10 seconds to appear
    $send = Wait-Named 'Send message' $BUTTON 14
  }
  if (-not $send) { throw 'send button did not appear' }

  # The button shows up before the app is ready for the click, so give it a moment. If the first click
  # is ignored, click once more: a duplicate message is better than a lost one.
  for ($click = 0; $click -lt 2; $click++) {
    Start-Sleep -Milliseconds 1000
    $send = Find-Named 'Send message' $BUTTON
    if (-not $send) { break }   # the button is gone: the app is already sending
    Invoke-El $send
    $until = (Get-Date).AddSeconds(8)
    do {
      Start-Sleep -Milliseconds 500
      if ((Count-Snippet) -gt $before) { Write-Output 'sent'; exit }
    } while ((Get-Date) -lt $until)
  }
  $until = (Get-Date).AddSeconds(8)
  do {
    Start-Sleep -Milliseconds 500
    if ((Count-Snippet) -gt $before) { Write-Output 'sent'; exit }
  } while ((Get-Date) -lt $until)
  throw 'message was not submitted'} catch {
  Write-Output ('error:' + $_.Exception.Message)
}
