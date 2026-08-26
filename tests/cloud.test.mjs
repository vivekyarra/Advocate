import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../src/seed.js';
import { buildBillComparison, createCloudAdvocateService } from '../src/cloud.js';

function cloudState() {
  const state = createSeedState();
  return {
    ...state,
    balanceCents: 9437,
    profile: { fullName: 'Jordan Lee', phone: null, timezone: 'America/Los_Angeles', billingAlerts: true, serviceUpdates: true, isDemo: true },
    account: { ...state.account, accountNumber: 'ADV-ABCD4821', serviceAddress: '1840 Market Street', serviceCity: 'San Francisco', serviceState: 'CA', servicePostal: '94102', autopay: true, paperless: true },
    usage: [],
    tickets: []
  };
}

test('cloud bill comparison preserves the exact challenge math', () => {
  const comparison = buildBillComparison(cloudState());
  assert.equal(comparison.currentAmountCents, 9437);
  assert.equal(comparison.previousAmountCents, 5900);
  assert.equal(comparison.deltaCents, 3537);
  assert.deepEqual(comparison.changes.map((item) => item.amountCents), [2500, 1037]);
});

test('cloud service routes sensitive actions through backend RPCs', async () => {
  const calls = [];
  const api = {
    async rpc(name, args = {}) {
      calls.push([name, args]);
      if (name === 'get_app_state') return cloudState();
      if (name === 'grant_resolution_approval') return { bill_fixes: true, plan_id: args.p_include_plan ? args.p_plan_id : null };
      if (name === 'approve_plan_change') return { approved_plan_id: args.p_plan_id };
      if (name === 'apply_outage_credit') return { applied: true, amount_cents: 1280, balance_cents: 8157 };
      if (name === 'refund_invalid_charge') return { refunded: true, amount_cents: 1037, balance_cents: 7120 };
      if (name === 'change_plan') return { changed: true, plan_id: args.p_plan_id, monthly_cents: 6700, monthly_savings_cents: 1700 };
      return null;
    }
  };
  const service = createCloudAdvocateService(api);
  await service.approveResolution({ includePlan: false });
  await service.applyOutageCredit({ outage_id: 'outage-2026-08-22' });
  await service.refundInvalidCharge({ charge_id: 'install-fee-2026-08' });
  await service.approvePlanChange('fiber-500-flex');
  await service.changePlan({ plan_id: 'fiber-500-flex' });
  assert.deepEqual(calls.filter(([name]) => name !== 'get_app_state').map(([name]) => name), [
    'grant_resolution_approval', 'apply_outage_credit', 'refund_invalid_charge', 'approve_plan_change', 'change_plan'
  ]);
  assert.equal(calls.at(-1)[1].p_plan_id, 'fiber-500-flex');
});

test('cloud service marks read discoveries in persistent backend state', async () => {
  const calls = [];
  const api = {
    async rpc(name, args = {}) {
      calls.push([name, args]);
      if (name === 'get_app_state') return cloudState();
      return cloudState();
    }
  };
  const service = createCloudAdvocateService(api);
  await service.compareBills();
  await service.getOutageHistory();
  await service.checkCreditEligibility({ outage_id: 'outage-2026-08-22' });
  await service.checkChargeValidity({ charge_id: 'install-fee-2026-08' });
  await service.listPlanOptions();
  assert.deepEqual(calls.filter(([name]) => name === 'record_discovery').map(([, args]) => args.p_key), [
    'comparedBills', 'outageReviewed', 'creditChecked', 'chargeChecked', 'plansReviewed'
  ]);
});
