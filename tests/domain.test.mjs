import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/repository.js';
import { createAdvocateService, calculateBalanceCents } from '../src/domain.js';

function clockSequence(...dates) {
  let index = 0;
  return () => new Date(dates[Math.min(index++, dates.length - 1)]);
}

function setup(clock = () => new Date('2026-08-26T10:30:00.000Z')) {
  const repo = new MemoryRepository();
  const events = [];
  const service = createAdvocateService(repo, { onEvent: (event) => events.push(event) }, clock);
  return { repo, service, events };
}

test('seed account has the intended $94.37 bill and $59 previous bill', async () => {
  const { repo, service } = setup();
  const state = await repo.read();
  assert.equal(calculateBalanceCents(state), 9437);
  const current = await service.getCurrentBill();
  assert.equal(current.amount_due_cents, 9437);
  const previous = await service.getPreviousBills();
  assert.equal(previous[0].amount_cents, 5900);
});

test('bill comparison explains the full $35.37 increase', async () => {
  const { service } = setup();
  const comparison = await service.compareBills();
  assert.equal(comparison.deltaCents, 3537);
  assert.deepEqual(comparison.changes.map((item) => item.amountCents), [2500, 1037]);
  assert.equal(comparison.changes.reduce((sum, item) => sum + item.amountCents, 0), 3537);
});

test('outage and invalid fee checks recover exactly $23.17', async () => {
  const { service } = setup();
  const outage = await service.checkCreditEligibility({ outage_id: 'outage-2026-08-22' });
  const charge = await service.checkChargeValidity({ charge_id: 'install-fee-2026-08' });
  assert.equal(outage.credit_cents + charge.refund_cents, 2317);
  assert.equal(outage.eligible, true);
  assert.equal(charge.refundable, true);
});

test('write tools are blocked before human approval', async () => {
  const { service, repo } = setup();
  await assert.rejects(service.applyOutageCredit({ outage_id: 'outage-2026-08-22' }), /Human approval required/);
  await assert.rejects(service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' }), /Human approval required/);
  await assert.rejects(service.changePlan({ plan_id: 'fiber-500-flex' }), /Human approval required/);
  assert.equal((await repo.read()).ledger.length, 0);
});

test('bill-only approval cannot authorize a plan change', async () => {
  const { service } = setup();
  await service.approveResolution({ includePlan: false });
  await service.applyOutageCredit({ outage_id: 'outage-2026-08-22' });
  await service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' });
  await assert.rejects(service.changePlan({ plan_id: 'fiber-500-flex' }), /exact plan/);
  const receipt = await service.getResolutionReceipt();
  assert.equal(receipt.new_balance_cents, 7120);
  assert.equal(receipt.plan_changed, false);
  assert.equal(receipt.status, 'resolved');
});

test('approved bill fixes are idempotent under repeated execution', async () => {
  const { service, repo } = setup();
  await service.approveResolution({ includePlan: false });
  await Promise.all(Array.from({ length: 20 }, () => service.applyOutageCredit({ outage_id: 'outage-2026-08-22' })));
  await Promise.all(Array.from({ length: 20 }, () => service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' })));
  const state = await repo.read();
  assert.equal(state.ledger.length, 2);
  assert.equal(calculateBalanceCents(state), 7120);
});

test('plan switch requires exact approval and preserves current bill balance', async () => {
  const { service, repo } = setup();
  await service.approveResolution({ includePlan: true, planId: 'fiber-500-flex' });
  await assert.rejects(service.changePlan({ plan_id: 'fiber-gig' }), /exact plan/);
  const changed = await service.changePlan({ plan_id: 'fiber-500-flex' });
  assert.equal(changed.changed, true);
  assert.equal(changed.monthly_cents, 6700);
  assert.equal((await repo.read()).plan.name, 'Fiber 500 Flex');
  assert.equal(calculateBalanceCents(await repo.read()), 9437);
});

test('full resolution produces exact receipt and elapsed time', async () => {
  const { service } = setup(clockSequence(
    '2026-08-26T10:30:00.000Z',
    '2026-08-26T10:30:05.000Z',
    '2026-08-26T10:30:10.000Z',
    '2026-08-26T10:30:34.000Z',
    '2026-08-26T10:30:34.000Z',
    '2026-08-26T10:30:35.000Z'
  ));
  await service.compareBills();
  await service.checkCreditEligibility({ outage_id: 'outage-2026-08-22' });
  await service.approveResolution({ includePlan: false });
  await service.applyOutageCredit({ outage_id: 'outage-2026-08-22' });
  await service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' });
  const receipt = await service.getResolutionReceipt();
  assert.equal(receipt.previous_bill_cents, 9437);
  assert.equal(receipt.outage_credit_cents, 1280);
  assert.equal(receipt.invalid_charge_refund_cents, 1037);
  assert.equal(receipt.new_balance_cents, 7120);
  assert.equal(receipt.plan_changed, false);
  assert.equal(receipt.status, 'resolved');
  assert.equal(receipt.elapsed_seconds, 34);
});
