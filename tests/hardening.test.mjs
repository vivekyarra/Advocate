import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createToolDefinitions, createWebMcpRuntime, installAdvocateWebMcp, validateInput } from '../src/webmcp.js';
import { resolveRequestFile } from '../scripts/serve.mjs';

function validClaimPayload() {
  return {
    case_id: 'INV-0427',
    claimant: 'Northstar Studio LLC',
    counterparty: 'Atlas Procurement Inc.',
    clause_id: 'payment_terms_7_4',
    breach_clause: '§ 7.4 Settlement Timing',
    jurisdiction: 'CA',
    delay_days: 32,
    base_amount: 12840,
    statutory_penalty: 112.57,
    claim_total: 12952.57,
    statutory_citation: 'Cal. Civ. Code § 3289(b)',
    authorization_proof: 'b'.repeat(64),
    approved_at: '2026-08-27T00:00:00.000Z'
  };
}

test('recursively validates nested claim payloads and exact SHA-256 proof format', () => {
  const noticeTool = createToolDefinitions().find((tool) => tool.name === 'generate_enforceable_demand_notice');
  const payload = validClaimPayload();
  payload.authorization_proof = 'not-a-hash';
  payload.surprise = true;
  const validation = validateInput(noticeTool.inputSchema, { claim_payload: payload });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /authorization_proof/);
  assert.match(validation.errors.join(' '), /surprise/);
});

test('rejects tampered claim arithmetic and citation before notice generation', async () => {
  const runtime = createWebMcpRuntime();
  const payload = validClaimPayload();
  payload.claim_total = 999999;
  await assert.rejects(
    runtime.invoke('generate_enforceable_demand_notice', { claim_payload: payload }),
    /claim_total does not match/
  );

  payload.claim_total = 12952.57;
  payload.statutory_citation = 'Wrong citation';
  await assert.rejects(
    runtime.invoke('generate_enforceable_demand_notice', { claim_payload: payload }),
    /statutory_citation does not match/
  );
});

test('replay still requires the original authorization proof', async () => {
  const runtime = createWebMcpRuntime();
  const payload = validClaimPayload();
  const generated = await runtime.invoke('generate_enforceable_demand_notice', { claim_payload: payload });
  await runtime.invoke('file_dispute_record', { action_id: generated.notice.action_id, proof_hash: payload.authorization_proof });
  await assert.rejects(
    runtime.invoke('file_dispute_record', { action_id: generated.notice.action_id, proof_hash: 'c'.repeat(64) }),
    /does not match the authorized notice/
  );
  assert.equal(runtime.receiptCount, 1);
});

test('tool annotations accurately describe non-idempotent generation and destructive filing', () => {
  const tools = createToolDefinitions();
  const generate = tools.find((tool) => tool.name === 'generate_enforceable_demand_notice');
  const file = tools.find((tool) => tool.name === 'file_dispute_record');
  assert.equal(generate.annotations.idempotentHint, false);
  assert.equal(generate.annotations.destructiveHint, false);
  assert.equal(file.annotations.idempotentHint, true);
  assert.equal(file.annotations.destructiveHint, true);
});

test('partial native WebMCP registration aborts already-registered tools', async () => {
  const originalDocument = globalThis.document;
  let calls = 0;
  let aborted = false;
  globalThis.document = {
    modelContext: {
      async registerTool(_tool, { signal }) {
        calls += 1;
        signal.addEventListener('abort', () => { aborted = true; }, { once: true });
        if (calls === 2) throw new Error('simulated registration failure');
      }
    }
  };

  try {
    const installation = await installAdvocateWebMcp();
    assert.equal(installation.native, false);
    assert.equal(installation.registered, 0);
    assert.equal(aborted, true);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('development server rejects path traversal and malformed encoded URLs', () => {
  const root = resolve('/tmp/advocate');
  assert.equal(resolveRequestFile(root, '/../advocate-secrets/token.txt').status, 403);
  assert.equal(resolveRequestFile(root, '/%E0%A4%A').status, 400);
  assert.equal(resolveRequestFile(root, '/src/main.js?cache=1').file, resolve(root, 'src/main.js'));
});
