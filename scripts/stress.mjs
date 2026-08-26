import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/repository.js';
import { createAdvocateService, calculateBalanceCents } from '../src/domain.js';

const RUNS = 750;
let unauthorizedBlocks = 0;
let idempotentReplays = 0;

for (let i = 0; i < RUNS; i++) {
  const repo = new MemoryRepository();
  const service = createAdvocateService(repo, {}, () => new Date(1760000000000 + i * 1000));
  const wantsPlan = i % 3 === 0;

  // Vary investigation order to ensure tools do not depend on a fragile sequence.
  const reads = [
    () => service.getCurrentBill(),
    () => service.compareBills(),
    () => service.getOutageHistory(),
    () => service.checkCreditEligibility({ outage_id: 'outage-2026-08-22' }),
    () => service.checkChargeValidity({ charge_id: 'install-fee-2026-08' }),
    () => service.listPlanOptions()
  ];
  reads.sort(() => ((i * 17 + 11) % 7) / 7 - 0.5);
  for (const read of reads) await read();

  // Probe all writes before approval; none may change account state.
  for (const write of [
    () => service.applyOutageCredit({ outage_id: 'outage-2026-08-22' }),
    () => service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' }),
    () => service.changePlan({ plan_id: 'fiber-500-flex' })
  ]) {
    try { await write(); throw new Error('Unauthorized write unexpectedly succeeded'); }
    catch (error) { if (/Human approval required/.test(String(error))) unauthorizedBlocks++; else throw error; }
  }
  assert.equal(calculateBalanceCents(await repo.read()), 9437);

  await service.approveResolution({ includePlan: wantsPlan, planId: 'fiber-500-flex' });

  // Hammer concurrent duplicate write calls. Ledger and plan must remain idempotent.
  await Promise.all(Array.from({ length: 8 }, () => service.applyOutageCredit({ outage_id: 'outage-2026-08-22' })));
  await Promise.all(Array.from({ length: 8 }, () => service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' })));
  idempotentReplays += 14;

  if (wantsPlan) {
    await Promise.all(Array.from({ length: 5 }, () => service.changePlan({ plan_id: 'fiber-500-flex' })));
  } else {
    try { await service.changePlan({ plan_id: 'fiber-500-flex' }); throw new Error('Unapproved plan change succeeded'); }
    catch (error) { assert.match(String(error), /exact plan/); unauthorizedBlocks++; }
  }

  const state = await repo.read();
  const receipt = await service.getResolutionReceipt();
  assert.equal(state.ledger.length, 2);
  assert.equal(calculateBalanceCents(state), 7120);
  assert.equal(receipt.new_balance_cents, 7120);
  assert.equal(receipt.outage_credit_cents, 1280);
  assert.equal(receipt.invalid_charge_refund_cents, 1037);
  assert.equal(receipt.status, 'resolved');
  assert.equal(receipt.plan_changed, wantsPlan);
  assert.equal(state.plan.monthlyCents, wantsPlan ? 6700 : 8400);
}

console.log(`Stress test passed: ${RUNS} fresh accounts, ${unauthorizedBlocks} blocked unauthorized writes, ${idempotentReplays} duplicate write replays.`);
