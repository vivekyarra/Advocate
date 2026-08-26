import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolDefinitions, createWebMcpRuntime, validateInput } from '../src/webmcp.js';

const requiredTools = [
  'fetch_contract_clause',
  'compute_statutory_penalty',
  'generate_enforceable_demand_notice',
  'file_dispute_record'
];

function claimPayload({ clause, penalty, proof = 'a'.repeat(64) }) {
  return {
    case_id: 'INV-0427',
    claimant: 'Northstar Studio LLC',
    counterparty: 'Atlas Procurement Inc.',
    clause_id: clause.clause_id,
    breach_clause: clause.heading,
    jurisdiction: 'CA',
    delay_days: clause.breach_delay_days,
    base_amount: penalty.base_amount,
    statutory_penalty: penalty.statutory_penalty,
    claim_total: penalty.claim_total,
    statutory_citation: penalty.statutory_citation,
    authorization_proof: proof,
    approved_at: '2026-08-27T00:00:00.000Z'
  };
}

test('exposes the four challenge WebMCP tools with closed JSON schemas', () => {
  const tools = createToolDefinitions();
  assert.deepEqual(tools.map((tool) => tool.name), requiredTools);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.execute, 'function');
  }
  const notice = tools.find((tool) => tool.name === 'generate_enforceable_demand_notice');
  assert.equal(notice.inputSchema.properties.claim_payload.additionalProperties, false);
});

test('rejects malformed typed tool payloads before execution', () => {
  const tool = createToolDefinitions().find((item) => item.name === 'compute_statutory_penalty');
  const result = validateInput(tool.inputSchema, { jurisdiction: 'CA', delay_days: -1, base_amount: 100, surprise: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /delay_days/);
  assert.match(result.errors.join(' '), /surprise/);
});

test('executes the corrected breach-to-receipt pipeline and makes filing idempotent', async () => {
  const events = [];
  const runtime = createWebMcpRuntime({ telemetrySink: (event) => events.push(event) });
  const clause = await runtime.invoke('fetch_contract_clause', { clause_id: 'payment_terms_7_4' }, 'test-agent');
  assert.equal(clause.clause.breach_term, '15 calendar days');
  assert.equal(clause.clause.days_after_acceptance, 47);
  assert.equal(clause.clause.breach_delay_days, 32);

  const penalty = await runtime.invoke('compute_statutory_penalty', { jurisdiction: 'CA', delay_days: clause.clause.breach_delay_days, base_amount: 12840 }, 'test-agent');
  assert.equal(penalty.claim_total, 12952.57);
  assert.equal(penalty.statutory_penalty, 112.57);
  assert.equal(penalty.statutory_citation, 'Cal. Civ. Code § 3289(b)');

  const proof = 'a'.repeat(64);
  const generated = await runtime.invoke('generate_enforceable_demand_notice', {
    claim_payload: claimPayload({ clause: clause.clause, penalty, proof })
  }, 'test-agent');
  assert.match(generated.notice.action_id, /^ACT-/);

  const first = await runtime.invoke('file_dispute_record', { action_id: generated.notice.action_id, proof_hash: proof }, 'test-agent');
  const second = await runtime.invoke('file_dispute_record', { action_id: generated.notice.action_id, proof_hash: proof }, 'test-agent');
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(first.receipt.receipt_hash.length, 64);
  assert.equal(runtime.receiptCount, 1);
  assert.ok(events.some((event) => event.kind === 'schema' && event.valid));
  assert.ok(events.some((event) => event.kind === 'result' && typeof event.latency_ms === 'number'));
});
