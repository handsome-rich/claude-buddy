const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENTS, applyDashboardHooks } = require('../hooks-config');

const buddyHook = (s, ev) => s.hooks[ev].flatMap((e) => e.hooks).find((h) => h.command.includes('/sessions/event'));

test('adds one buddy hook for every event', () => {
  const s = {};
  assert.equal(applyDashboardHooks(s, 13120), true);
  for (const ev of EVENTS) assert.equal(s.hooks[ev].length, 1, ev);
});

test('PermissionRequest prints the answer so the pet can allow or deny', () => {
  const s = {};
  applyDashboardHooks(s, 13120);
  const h = buddyHook(s, 'PermissionRequest');
  assert.ok(h.command.startsWith('curl -s -X POST http://127.0.0.1:13120/sessions/event'));
  assert.ok(!h.command.includes('> /dev/null'));
  assert.ok(h.command.endsWith('2>/dev/null'));
});

test('other hooks post the event and discard the output', () => {
  const s = {};
  applyDashboardHooks(s, 13120);
  for (const ev of EVENTS.filter((e) => e !== 'PermissionRequest')) {
    const h = buddyHook(s, ev);
    assert.equal(h.type, 'command', ev);
    assert.ok(h.command.startsWith('curl -s -X POST http://127.0.0.1:13120/sessions/event'), ev);
    assert.ok(h.command.endsWith('> /dev/null 2>&1'), ev);
  }
});

test('a second run changes nothing', () => {
  const s = {};
  applyDashboardHooks(s, 13120);
  assert.equal(applyDashboardHooks(s, 13120), false);
});

test('upgrades an old PermissionRequest hook in place', () => {
  const old = "curl -s -X POST http://127.0.0.1:13120/sessions/event -H 'Content-Type: application/json' -d @- > /dev/null 2>&1";
  const s = { hooks: { PermissionRequest: [{ matcher: '', hooks: [{ type: 'command', command: old }] }] } };
  assert.equal(applyDashboardHooks(s, 13120), true);
  assert.equal(s.hooks.PermissionRequest.length, 1);
  assert.ok(!s.hooks.PermissionRequest[0].hooks[0].command.includes('> /dev/null'));
});

test('moves an old-port hook to the new port and keeps the user hooks', () => {
  const old = 'curl -s -X POST http://127.0.0.1:3120/sessions/event -d @- > /dev/null 2>&1';
  const s = { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo mine' }, { type: 'command', command: old }] }] } };
  assert.equal(applyDashboardHooks(s, 13120), true);
  assert.equal(s.hooks.Stop.length, 1);
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'echo mine');
  assert.ok(s.hooks.Stop[0].hooks[1].command.includes('127.0.0.1:13120/'));
});

test('replaces an http-type buddy hook with the curl command', () => {
  const s = { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'http', url: 'http://127.0.0.1:13120/sessions/event' }] }] } };
  applyDashboardHooks(s, 13120);
  assert.equal(s.hooks.Stop[0].hooks[0].type, 'command');
});

test('leaves other events and malformed entries alone', () => {
  const s = { hooks: { PreCompact: [{ hooks: [{ type: 'command', command: 'x' }] }], Stop: [{ matcher: 'odd' }] } };
  applyDashboardHooks(s, 13120);
  assert.deepEqual(s.hooks.PreCompact, [{ hooks: [{ type: 'command', command: 'x' }] }]);
  assert.deepEqual(s.hooks.Stop[0], { matcher: 'odd' });
  assert.equal(s.hooks.Stop.length, 2);
});
