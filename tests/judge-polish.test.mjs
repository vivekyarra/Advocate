import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { agentStatusPresentation, normalizeNotificationPayload, relativeNotificationTime, workflowPresentation } from '../src/judge-polish.js';

function caseState(overrides = {}) {
  return {
    balanceCents: overrides.balanceCents ?? 9437,
    plan: { id: 'fiber-500', name: 'Fiber 500', monthlyCents: 8400 },
    planOptions: [{ id: 'fiber-500-flex', name: 'Fiber 500 Flex', monthlyCents: 6700, equivalentToCurrent: true }],
    bills: [
      { id: 'aug', status: 'due', originalAmountCents: 9437, charges: [{ id: 'install', amountCents: 1037, valid: false }] },
      { id: 'jul', status: 'paid', originalAmountCents: 5900, charges: [] }
    ],
    outages: [{ id: 'outage', confirmed: true, creditEligible: true, creditCents: 1280, durationMinutes: 402 }],
    ledger: overrides.ledger || [],
    case: {
      status: overrides.status || 'idle',
      discoveries: { comparedBills: false, outageReviewed: false, creditChecked: false, chargeChecked: false, plansReviewed: false, ...(overrides.discoveries || {}) },
      approval: { billFixes: false, planId: null, ...(overrides.approval || {}) },
      actions: { outageCreditApplied: false, invalidChargeRefunded: false, planChanged: false, ...(overrides.actions || {}) }
    }
  };
}

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

test('live case theater advances through proof, authorization, execution, and receipt', () => {
  const idle = workflowPresentation(caseState());
  assert.equal(idle.phase, 'idle');
  assert.equal(idle.metric, '$94.37');

  const investigating = workflowPresentation(caseState({ discoveries: { comparedBills: true, outageReviewed: true } }));
  assert.equal(investigating.phase, 'investigating');
  assert.equal(investigating.metric, '2/5');

  const ready = workflowPresentation(caseState({ discoveries: { comparedBills: true, outageReviewed: true, creditChecked: true, chargeChecked: true, plansReviewed: true } }));
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.title, '$23.17 is recoverable now.');
  assert.equal(ready.metric, '$71.20');

  const authorized = workflowPresentation(caseState({
    status: 'approved',
    discoveries: { comparedBills: true, outageReviewed: true, creditChecked: true, chargeChecked: true, plansReviewed: true },
    approval: { billFixes: true, planId: null }
  }));
  assert.equal(authorized.phase, 'authorized');
  assert.match(authorized.title, /Money has not moved/);

  const executing = workflowPresentation(caseState({
    status: 'in_progress',
    discoveries: { comparedBills: true, outageReviewed: true, creditChecked: true, chargeChecked: true, plansReviewed: true },
    approval: { billFixes: true, planId: null },
    actions: { outageCreditApplied: true }
  }));
  assert.equal(executing.phase, 'executing');
  assert.equal(executing.metric, '1/2');

  const resolved = workflowPresentation(caseState({
    status: 'resolved',
    balanceCents: 7120,
    approval: { billFixes: true, planId: null },
    actions: { outageCreditApplied: true, invalidChargeRefunded: true }
  }));
  assert.equal(resolved.phase, 'resolved');
  assert.equal(resolved.metric, '$71.20');
  assert.match(resolved.title, /No support ticket/);
});

test('judge approval layer authorizes only and leaves execution to the WebMCP agent', async () => {
  const polish = await readFile(new URL('../src/judge-polish.js', import.meta.url), 'utf8');
  assert.match(polish, /grant_resolution_approval/);
  assert.match(polish, /Money has not moved/);
  assert.match(polish, /addEventListener\('click', onApprovalClick, true\)/);
  assert.doesNotMatch(polish, /api\.rpc\('apply_outage_credit'/);
  assert.doesNotMatch(polish, /api\.rpc\('refund_invalid_charge'/);
  assert.doesNotMatch(polish, /api\.rpc\('change_plan'/);
});

test('new accounts auto-login immediately after sign-up', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /async function createAccountAndSignIn/);
  assert.match(main, /await auth\.signUp\(\{ name, email, password \}\);\s*return auth\.signIn\(\{ email, password, rememberMe: true \}\);/s);
  assert.match(main, /loginFlow\(\(\) => createAccountAndSignIn\(\{ name, email, password, demo: false \}\)/);
  assert.match(main, /createAccountAndSignIn\(\{ name: 'Jordan Lee', email, password, demo: true \}\)/);
});
