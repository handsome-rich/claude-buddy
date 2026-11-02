// Buddy's entries in ~/.claude/settings.json. Pure, so tests run without Electron.
const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd',
];

function dashboardHook(port) {
  const command = `curl -s -X POST http://127.0.0.1:${port}/sessions/event -H 'Content-Type: application/json' -d @- > /dev/null 2>&1`;
  return { type: 'command', command };
}

function isDashboardHook(hook) {
  const target = (hook && (hook.url || hook.command)) || '';
  return target.includes('127.0.0.1:') && target.includes('/sessions/event');
}

const sameHook = (a, b) => a.type === b.type && a.command === b.command;

// Adds or updates buddy's hook for every event, in place. Returns true if settings changed.
function applyDashboardHooks(settings, port) {
  const want = dashboardHook(port);
  if (!settings.hooks) settings.hooks = {};
  let changed = false;
  for (const ev of EVENTS) {
    const existing = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    let found = false;
    settings.hooks[ev] = existing.map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;
      let entryChanged = false;
      const hooks = entry.hooks.map((hook) => {
        if (!isDashboardHook(hook)) return hook;
        found = true;
        if (sameHook(hook, want)) return hook;
        entryChanged = true;
        return { ...want };
      });
      if (!entryChanged) return entry;
      changed = true;
      return { ...entry, hooks };
    });
    if (!found) {
      settings.hooks[ev].push({ matcher: '', hooks: [{ ...want }] });
      changed = true;
    }
  }
  return changed;
}

module.exports = { EVENTS, applyDashboardHooks };
