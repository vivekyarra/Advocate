import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { agentStatusPresentation, normalizeNotificationPayload, relativeNotificationTime } from '../src/judge-polish.js';

test('agent status is confident without falsely claiming unsupported browser connection', () => {
  assert.deepEqual(agentStatusPresentation({ supported: true, count: 14 }), {
    label: 'Agent connected · 14 tools',
    detail: 'WebMCP is connected in this browser. Your authorized agent can inspect and act on this signed-in account now.',
    state: 'Connected now'
  });
  const unsupported = agentStatusPresentation({ supported: false, count: 14 });
  assert.equal(unsupported.label, 'Agent-ready · 14 tools');
  assert.match(unsupported.detail, /ChatGPT’s in-app browser/);
  assert.doesNotMatch(unsupported.label, /unavailable/i);
});

test('notification payload preserves real unread state and safe navigation targets', () => {
  const payload = normalizeNotificationPayload({
    read_at: '2026-08-26T12:00:00Z',
    unread_count: 2,
    items: [
      { id: 'bill:1', type: 'billing', title: 'Statement ready', body: 'August bill is ready.', created_at: '2026-08-26T12:30:00Z', target: 'billing', unread: true },
      { id: 'outage:1', type: 'service', title: 'Service restored', body: 'Outage resolved.', created_at: '2026-08-26T11:00:00Z', target: 'outages', unread: false }
    ]
  });
  assert.equal(payload.unreadCount, 2);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].target, 'billing');
  assert.equal(payload.items[0].unread, true);
  assert.equal(payload.items[1].target, 'outages');
});

test('relative notification time is deterministic for judge-visible freshness', () => {
  const now = Date.parse('2026-08-26T12:30:00Z');
  assert.equal(relativeNotificationTime('2026-08-26T12:29:20Z', now), 'Just now');
  assert.equal(relativeNotificationTime('2026-08-26T12:00:00Z', now), '30m ago');
  assert.equal(relativeNotificationTime('2026-08-26T09:30:00Z', now), '3h ago');
});

test('new accounts auto-login immediately after sign-up', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /async function createAccountAndSignIn/);
  assert.match(main, /await auth\.signUp\(\{ name, email, password \}\);\s*return auth\.signIn\(\{ email, password, rememberMe: true \}\);/s);
  assert.match(main, /loginFlow\(\(\) => createAccountAndSignIn\(\{ name, email, password, demo: false \}\)/);
  assert.match(main, /createAccountAndSignIn\(\{ name: 'Jordan Lee', email, password, demo: true \}\)/);
});