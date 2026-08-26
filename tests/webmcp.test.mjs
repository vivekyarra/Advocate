import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/repository.js';
import { createAdvocateService } from '../src/domain.js';
import { createToolDefinitions } from '../src/webmcp.js';

function schemaDescriptions(schema) {
  return Object.values(schema?.properties || {}).map((property) => property?.description).filter(Boolean);
}

test('registers a non-trivial, uniquely named WebMCP tool surface', () => {
  const tools = createToolDefinitions(createAdvocateService(new MemoryRepository()));
  assert.equal(tools.length, 16);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z0-9_]{1,30}$/);
    assert.ok(tool.description.length <= 500);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.execute, 'function');
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    for (const description of schemaDescriptions(tool.inputSchema)) assert.ok(description.length <= 150);
  }
});

test('read tools return compact JSON strings an agent can parse', async () => {
  const service = createAdvocateService(new MemoryRepository());
  const tools = createToolDefinitions(service);
  const currentBill = tools.find((tool) => tool.name === 'get_current_bill');
  const result = JSON.parse(await currentBill.execute({}));
  assert.equal(result.amount_due_cents, 9437);
  assert.equal(result.plan, 'Fiber 500');
});

test('intent-level investigation produces the complete evidence-backed resolution', async () => {
  const service = createAdvocateService(new MemoryRepository());
  const investigate = createToolDefinitions(service).find((tool) => tool.name === 'investigate_bill_issue');
  const raw = await investigate.execute({});
  const result = JSON.parse(raw);

  assert.equal(result.current_bill.amount_due_cents, 9437);
  assert.equal(result.previous_bill.amount_cents, 5900);
  assert.equal(result.eligible_outage_credits[0].credit_cents, 1280);
  assert.equal(result.invalid_charges[0].charge_id, 'install-fee-2026-08');
  assert.equal(result.invalid_charges[0].refund_cents, 1037);
  assert.equal(result.total_recovery_cents, 2317);
  assert.equal(result.projected_balance_after_fixes_cents, 7120);
  assert.equal(result.plan_opportunity.equivalent_plan_id, 'fiber-500-flex');
  assert.equal(result.human_approval.bill_fixes, false);
  assert.ok(raw.length <= 1500, `investigation output exceeds recommended WebMCP budget: ${raw.length}`);
});

test('intent-level resolution cannot bypass human approval and stays bill-only when that is the approved scope', async () => {
  const service = createAdvocateService(new MemoryRepository());
  const tools = createToolDefinitions(service);
  const investigate = tools.find((tool) => tool.name === 'investigate_bill_issue');
  const apply = tools.find((tool) => tool.name === 'apply_approved_resolution');

  await investigate.execute({});
  await assert.rejects(() => apply.execute({}), /Human approval required/);

  await service.approveResolution({ includePlan: false });
  const result = JSON.parse(await apply.execute({}));
  assert.equal(result.receipt.new_balance_cents, 7120);
  assert.equal(result.receipt.plan_changed, false);
  assert.equal(result.plan_change_requested, false);

  const repeated = JSON.parse(await apply.execute({}));
  assert.equal(repeated.receipt.new_balance_cents, 7120);
  assert.equal(repeated.receipt.plan_changed, false);
});

test('mutating tools are correctly marked non-read-only', () => {
  const tools = createToolDefinitions(createAdvocateService(new MemoryRepository()));
  const writes = new Set(['apply_approved_resolution', 'apply_outage_credit', 'refund_invalid_charge', 'change_plan']);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, !writes.has(tool.name), `${tool.name} annotation mismatch`);
  }
});
