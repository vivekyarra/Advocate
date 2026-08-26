const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const nowIso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();

function currentBill(state) {
  return state.bills.find((bill) => bill.status === 'due') || state.bills[0];
}

function previousBill(state) {
  const current = currentBill(state);
  return state.bills.find((bill) => bill.id !== current.id);
}

export function calculateBalanceCents(state) {
  return currentBill(state).originalAmountCents + state.ledger.reduce((sum, entry) => sum + entry.amountCents, 0);
}

export function buildBillComparison(state) {
  const current = currentBill(state);
  const previous = previousBill(state);
  const previousPromo = previous.charges.find((charge) => charge.category === 'discount');
  const install = current.charges.find((charge) => charge.category === 'one_time_fee');
  const changes = [];
  if (previousPromo) {
    changes.push({
      id: 'promo_expired',
      label: 'Promotional discount expired',
      amountCents: Math.abs(previousPromo.amountCents),
      explanation: 'Your 12-month $25 promotional discount ended on August 1.'
    });
  }
  if (install) {
    changes.push({
      id: install.id,
      label: install.label,
      amountCents: install.amountCents,
      explanation: 'A one-time installation fee appeared on this statement.'
    });
  }
  return {
    currentBillId: current.id,
    previousBillId: previous.id,
    currentAmountCents: calculateBalanceCents(state),
    previousAmountCents: previous.originalAmountCents,
    deltaCents: current.originalAmountCents - previous.originalAmountCents,
    changes
  };
}

function ensureCaseOpened(state, at) {
  if (!state.case.openedAt) state.case.openedAt = at;
  if (state.case.status === 'idle') state.case.status = 'investigating';
}

function audit(state, type, detail, at) {
  state.auditLog.push({ id: `${type}-${state.auditLog.length + 1}`, type, detail, at });
}

function finalizeIfComplete(state, at) {
  const billDone = state.case.actions.outageCreditApplied && state.case.actions.invalidChargeRefunded;
  const planNeeded = Boolean(state.case.approval.planId);
  const planDone = !planNeeded || state.case.actions.planChanged;
  if (billDone && planDone) {
    state.case.status = 'resolved';
    state.case.resolvedAt ||= at;
  } else if (billDone && planNeeded) {
    state.case.status = 'awaiting_plan_change';
  } else {
    state.case.status = 'in_progress';
  }
}

function elapsedSeconds(state) {
  if (!state.case.openedAt || !state.case.resolvedAt) return null;
  return Math.max(0, Math.round((new Date(state.case.resolvedAt) - new Date(state.case.openedAt)) / 1000));
}

export function createAdvocateService(repository, hooks = {}, clock = () => new Date()) {
  const emit = (event) => hooks.onEvent?.(event);
  const at = () => nowIso(clock());

  async function readWithAudit(type, label, mutateDiscovery, selector) {
    const timestamp = at();
    const result = await repository.update((state) => {
      ensureCaseOpened(state, timestamp);
      mutateDiscovery?.(state);
      audit(state, type, label, timestamp);
      return selector(state);
    });
    emit({ type, label, result, at: timestamp });
    return result;
  }

  return {
    async getState() {
      return repository.read();
    },

    async getCurrentBill() {
      return readWithAudit('get_current_bill', 'Opened current bill', null, (state) => {
        const bill = currentBill(state);
        return {
          bill_id: bill.id,
          period: bill.period,
          amount_due_cents: calculateBalanceCents(state),
          amount_due: money(calculateBalanceCents(state)),
          due_on: bill.dueOn,
          status: bill.status,
          plan: state.plan.name
        };
      });
    },

    async getPreviousBills() {
      return readWithAudit('get_previous_bills', 'Loaded previous statements', null, (state) => state.bills
        .filter((bill) => bill.status !== 'due')
        .map((bill) => ({ bill_id: bill.id, period: bill.period, amount_cents: bill.originalAmountCents, amount: money(bill.originalAmountCents), status: bill.status })));
    },

    async compareBills() {
      return readWithAudit('compare_bills', 'Compared August with July', (state) => { state.case.discoveries.comparedBills = true; }, (state) => buildBillComparison(state));
    },

    async getOutageHistory() {
      return readWithAudit('get_outage_history', 'Checked outage history', (state) => { state.case.discoveries.outageReviewed = true; }, (state) => state.outages.map((outage) => ({
        outage_id: outage.id,
        started_at: outage.startedAt,
        ended_at: outage.endedAt,
        duration_minutes: outage.durationMinutes,
        confirmed: outage.confirmed,
        reason: outage.reason
      })));
    },

    async explainCharge({ charge_id } = {}) {
      if (!charge_id) throw new Error('charge_id is required.');
      return readWithAudit('explain_charge', `Explained charge ${charge_id}`, null, (state) => {
        const charge = currentBill(state).charges.find((item) => item.id === charge_id);
        if (!charge) throw new Error(`Charge ${charge_id} was not found on the current bill.`);
        return {
          charge_id: charge.id,
          label: charge.label,
          amount_cents: charge.amountCents,
          amount: money(charge.amountCents),
          category: charge.category,
          explanation: charge.category === 'one_time_fee' ? 'A one-time installation fee was added to the August statement.' : 'Recurring monthly service charge.'
        };
      });
    },

    async checkCreditEligibility({ outage_id } = {}) {
      if (!outage_id) throw new Error('outage_id is required.');
      return readWithAudit('check_credit_eligibility', 'Verified outage credit eligibility', (state) => { state.case.discoveries.creditChecked = true; }, (state) => {
        const outage = state.outages.find((item) => item.id === outage_id);
        if (!outage) throw new Error(`Outage ${outage_id} was not found.`);
        return {
          outage_id: outage.id,
          eligible: outage.confirmed && outage.creditEligible,
          credit_cents: outage.creditCents,
          credit: money(outage.creditCents),
          policy: outage.policy
        };
      });
    },

    async checkChargeValidity({ charge_id } = {}) {
      if (!charge_id) throw new Error('charge_id is required.');
      return readWithAudit('check_charge_validity', 'Validated installation fee', (state) => { state.case.discoveries.chargeChecked = true; }, (state) => {
        const charge = currentBill(state).charges.find((item) => item.id === charge_id);
        if (!charge) throw new Error(`Charge ${charge_id} was not found on the current bill.`);
        return {
          charge_id: charge.id,
          valid: charge.valid,
          refundable: charge.valid === false,
          refund_cents: charge.valid === false ? charge.amountCents : 0,
          refund: charge.valid === false ? money(charge.amountCents) : '$0.00',
          reason: charge.invalidReason || 'Charge matches account activity.'
        };
      });
    },

    async listPlanOptions() {
      return readWithAudit('list_plan_options', 'Checked equivalent plan options', (state) => { state.case.discoveries.plansReviewed = true; }, (state) => ({
        current_plan: { id: state.plan.id, name: state.plan.name, speed_mbps: state.plan.speedMbps, monthly_cents: state.plan.monthlyCents, monthly: money(state.plan.monthlyCents) },
        options: state.planOptions.map((plan) => ({
          id: plan.id,
          name: plan.name,
          speed_mbps: plan.speedMbps,
          monthly_cents: plan.monthlyCents,
          monthly: money(plan.monthlyCents),
          monthly_savings_cents: state.plan.monthlyCents - plan.monthlyCents,
          equivalent_to_current: plan.equivalentToCurrent,
          contract: plan.contract
        }))
      }));
    },

    async getApprovalStatus() {
      return readWithAudit('get_approval_status', 'Checked human approval', null, (state) => ({
        bill_fixes_approved: state.case.approval.billFixes,
        approved_plan_id: state.case.approval.planId,
        status: state.case.status
      }));
    },

    async getResolutionSummary() {
      return readWithAudit('get_resolution_summary', 'Prepared resolution summary', null, (state) => {
        const outage = state.outages[0];
        const charge = currentBill(state).charges.find((item) => item.valid === false);
        const fixes = [];
        if (state.case.discoveries.creditChecked && outage.creditEligible) fixes.push({ type: 'outage_credit', amount_cents: outage.creditCents, amount: money(outage.creditCents) });
        if (state.case.discoveries.chargeChecked && charge) fixes.push({ type: 'invalid_charge_refund', charge_id: charge.id, amount_cents: charge.amountCents, amount: money(charge.amountCents) });
        const recovery = fixes.reduce((sum, fix) => sum + fix.amount_cents, 0);
        const alt = state.planOptions.find((plan) => plan.equivalentToCurrent);
        return {
          fixes,
          total_recovery_cents: recovery,
          total_recovery: money(recovery),
          current_balance_cents: calculateBalanceCents(state),
          projected_balance_after_fixes_cents: calculateBalanceCents(state) - recovery,
          plan_opportunity: state.case.discoveries.plansReviewed ? {
            current_monthly_cents: state.plan.monthlyCents,
            equivalent_plan_id: alt.id,
            equivalent_monthly_cents: alt.monthlyCents,
            monthly_savings_cents: state.plan.monthlyCents - alt.monthlyCents
          } : null,
          human_approval: {
            bill_fixes: state.case.approval.billFixes,
            plan_id: state.case.approval.planId
          }
        };
      });
    },

    async approveResolution({ includePlan = false, planId = 'fiber-500-flex' } = {}) {
      const timestamp = at();
      const result = await repository.update((state) => {
        ensureCaseOpened(state, timestamp);
        state.case.approval.billFixes = true;
        state.case.approval.planId = includePlan ? planId : null;
        state.case.approval.grantedAt = timestamp;
        state.case.status = 'approved';
        audit(state, 'human_approval', includePlan ? `Approved bill fixes and plan ${planId}` : 'Approved bill fixes only', timestamp);
        return { bill_fixes: true, plan_id: state.case.approval.planId, granted_at: timestamp };
      });
      emit({ type: 'human_approval', label: includePlan ? 'Customer approved bill fixes + plan switch' : 'Customer approved bill fixes only', result, at: timestamp });
      return result;
    },

    async applyOutageCredit({ outage_id } = {}) {
      if (!outage_id) throw new Error('outage_id is required.');
      const timestamp = at();
      const result = await repository.update((state) => {
        ensureCaseOpened(state, timestamp);
        if (!state.case.approval.billFixes) throw new Error('Human approval required. Ask the customer to choose a resolution option in the page before applying credits.');
        const outage = state.outages.find((item) => item.id === outage_id);
        if (!outage || !outage.confirmed || !outage.creditEligible) throw new Error('This outage is not eligible for a credit.');
        const existing = state.ledger.find((entry) => entry.sourceId === outage_id && entry.type === 'outage_credit');
        if (!existing) {
          state.ledger.push({ id: `ledger-outage-${outage_id}`, type: 'outage_credit', sourceId: outage.id, amountCents: -outage.creditCents, label: 'Confirmed outage service credit', createdAt: timestamp });
          state.case.actions.outageCreditApplied = true;
          audit(state, 'apply_outage_credit', `Applied ${money(outage.creditCents)} outage credit`, timestamp);
        } else {
          state.case.actions.outageCreditApplied = true;
          audit(state, 'apply_outage_credit', 'Outage credit already applied; no duplicate created', timestamp);
        }
        finalizeIfComplete(state, timestamp);
        return { applied: !existing, amount_cents: outage.creditCents, amount: money(outage.creditCents), balance_cents: calculateBalanceCents(state), balance: money(calculateBalanceCents(state)) };
      });
      emit({ type: 'apply_outage_credit', label: result.applied ? 'Applied $12.80 outage credit' : 'Confirmed outage credit already applied', result, at: timestamp });
      return result;
    },

    async refundInvalidCharge({ charge_id } = {}) {
      if (!charge_id) throw new Error('charge_id is required.');
      const timestamp = at();
      const result = await repository.update((state) => {
        ensureCaseOpened(state, timestamp);
        if (!state.case.approval.billFixes) throw new Error('Human approval required. Ask the customer to choose a resolution option in the page before issuing refunds.');
        const charge = currentBill(state).charges.find((item) => item.id === charge_id);
        if (!charge) throw new Error(`Charge ${charge_id} was not found.`);
        if (charge.valid !== false) throw new Error('This charge is valid and cannot be refunded by this tool.');
        const existing = state.ledger.find((entry) => entry.sourceId === charge_id && entry.type === 'charge_refund');
        if (!existing) {
          state.ledger.push({ id: `ledger-refund-${charge_id}`, type: 'charge_refund', sourceId: charge.id, amountCents: -charge.amountCents, label: 'Incorrect installation fee refund', createdAt: timestamp });
          state.case.actions.invalidChargeRefunded = true;
          audit(state, 'refund_invalid_charge', `Refunded ${money(charge.amountCents)} invalid fee`, timestamp);
        } else {
          state.case.actions.invalidChargeRefunded = true;
          audit(state, 'refund_invalid_charge', 'Invalid charge already refunded; no duplicate created', timestamp);
        }
        finalizeIfComplete(state, timestamp);
        return { refunded: !existing, amount_cents: charge.amountCents, amount: money(charge.amountCents), balance_cents: calculateBalanceCents(state), balance: money(calculateBalanceCents(state)) };
      });
      emit({ type: 'refund_invalid_charge', label: result.refunded ? 'Refunded $10.37 installation fee' : 'Confirmed installation fee already refunded', result, at: timestamp });
      return result;
    },

    async changePlan({ plan_id } = {}) {
      if (!plan_id) throw new Error('plan_id is required.');
      const timestamp = at();
      const result = await repository.update((state) => {
        ensureCaseOpened(state, timestamp);
        if (state.case.approval.planId !== plan_id) throw new Error(`Human approval required for plan ${plan_id}. The customer must explicitly approve that exact plan in the page.`);
        const target = state.planOptions.find((plan) => plan.id === plan_id);
        if (!target) throw new Error(`Plan ${plan_id} is not available.`);
        const alreadyChanged = state.plan.id === target.id;
        if (!alreadyChanged) {
          const previousMonthly = state.plan.monthlyCents;
          state.plan = { id: target.id, name: target.name, speedMbps: target.speedMbps, monthlyCents: target.monthlyCents, promoEndedOn: null };
          state.case.actions.planChanged = true;
          audit(state, 'change_plan', `Changed plan to ${target.name}`, timestamp);
          finalizeIfComplete(state, timestamp);
          return { changed: true, plan_id: target.id, plan: target.name, monthly_cents: target.monthlyCents, monthly: money(target.monthlyCents), monthly_savings_cents: previousMonthly - target.monthlyCents };
        }
        state.case.actions.planChanged = true;
        finalizeIfComplete(state, timestamp);
        audit(state, 'change_plan', `Plan ${target.name} already active; no duplicate change`, timestamp);
        return { changed: false, plan_id: target.id, plan: target.name, monthly_cents: target.monthlyCents, monthly: money(target.monthlyCents), monthly_savings_cents: 0 };
      });
      emit({ type: 'change_plan', label: result.changed ? `Changed plan to ${result.plan}` : `Confirmed ${result.plan} already active`, result, at: timestamp });
      return result;
    },

    async getResolutionReceipt() {
      return readWithAudit('get_resolution_receipt', 'Generated resolution receipt', null, (state) => {
        const bill = currentBill(state);
        const credit = state.ledger.find((entry) => entry.type === 'outage_credit');
        const refund = state.ledger.find((entry) => entry.type === 'charge_refund');
        return {
          case_id: state.case.id,
          status: state.case.status,
          previous_bill_cents: bill.originalAmountCents,
          previous_bill: money(bill.originalAmountCents),
          outage_credit_cents: credit ? Math.abs(credit.amountCents) : 0,
          outage_credit: credit ? money(Math.abs(credit.amountCents)) : '$0.00',
          invalid_charge_refund_cents: refund ? Math.abs(refund.amountCents) : 0,
          invalid_charge_refund: refund ? money(Math.abs(refund.amountCents)) : '$0.00',
          new_balance_cents: calculateBalanceCents(state),
          new_balance: money(calculateBalanceCents(state)),
          plan_changed: state.case.actions.planChanged,
          current_plan: state.plan.name,
          elapsed_seconds: elapsedSeconds(state)
        };
      });
    }
  };
}
