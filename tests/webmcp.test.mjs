import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/repository.js';
import { createAdvocateService } from '../src/domain.js';
import { createToolDefinitions } from '../src/webmcp.js';

test('registers a non-trivial, uniquely named WebMCP tool surface', () => {
  const tools = createToolDefinitions(createAdvocateService(new MemoryRepository()));
  assert.equal(tools.length, 14);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z0-9_]{1,30}$/);
    assert.ok(tool.description.length <= 500);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.execute, 'function');
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
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

test('mutating tools are correctly marked non-read-only', () => {
  const tools = createToolDefinitions(createAdvocateService(new MemoryRepository()));
  const writes = new Set(['apply_outage_credit', 'refund_invalid_charge', 'change_plan']);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, !writes.has(tool.name), `${tool.name} annotation mismatch`);
  }
});
