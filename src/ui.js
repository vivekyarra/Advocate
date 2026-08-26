import { calculateBalanceCents, buildBillComparison } from './domain.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function currentBill(state) { return state.bills.find((bill) => bill.status === 'due') || state.bills[0]; }

function show(element, visible = true) {
  element?.classList.toggle('hidden', !visible);
}

function statusLabel(status) {
  return ({ idle: 'No active review', investigating: 'Investigating', approved: 'Customer approved', in_progress: 'Applying fixes', awaiting_plan_change: 'Bill fixed · plan pending', resolved: 'Resolved' })[status] || status;
}

export function createUI(repository) {
  const activity = [];

  async function render() {
    const state = await repository.read();
    const bill = currentBill(state);
    const previous = state.bills.find((item) => item.id !== bill.id);
    const balance = calculateBalanceCents(state);
    const comparison = buildBillComparison(state);

    $('#currentAmount').textContent = money(balance);
    $('#statementDue').textContent = money(balance);
    $('#statementTotal').textContent = money(balance);
    $('#previousAmount').textContent = money(previous.originalAmountCents);
    $('#billDelta').textContent = `+${money(comparison.deltaCents)}`;
    $('#currentPlanName').textContent = state.plan.name;
    $('#currentPlanPrice').textContent = `${money(state.plan.monthlyCents)}/mo`;
    $('#caseStatus').textContent = statusLabel(state.case.status);

    $('#chargeRows').innerHTML = bill.charges.map((charge) => `<div class="statement-line"><div><strong>${charge.label}</strong><small>${charge.category === 'service' ? 'Monthly service' : 'One-time charge'}</small></div><span>${money(charge.amountCents)}</span></div>`).join('') +
      state.ledger.map((entry) => `<div class="statement-line adjustment"><div><strong>${entry.label}</strong><small>Account adjustment</small></div><span>${money(entry.amountCents)}</span></div>`).join('');

    const hasInvestigation = Object.values(state.case.discoveries).some(Boolean);
    show($('#idleResolution'), !hasInvestigation && state.case.status === 'idle');
    show($('#investigationView'), hasInvestigation);

    const compareRows = [];
    if (state.case.discoveries.comparedBills) {
      for (const change of comparison.changes) {
        compareRows.push(`<div class="finding-row"><div><strong>${change.label}</strong><span>${change.explanation}</span></div><b>+${money(change.amountCents)}</b></div>`);
      }
    }
    $('#comparisonRows').innerHTML = compareRows.length ? compareRows.join('') : '<div class="finding-placeholder">Waiting for bill comparison…</div>';

    const entitlementRows = [];
    const outage = state.outages[0];
    const invalidCharge = bill.charges.find((charge) => charge.valid === false);
    if (state.case.discoveries.creditChecked) entitlementRows.push(`<div class="finding-row success"><div><strong>Outage service credit</strong><span>${outage.durationMinutes} minute confirmed outage · eligible</span></div><b>+${money(outage.creditCents)}</b></div>`);
    if (state.case.discoveries.chargeChecked && invalidCharge) entitlementRows.push(`<div class="finding-row success"><div><strong>Incorrect installation fee</strong><span>${invalidCharge.invalidReason}</span></div><b>+${money(invalidCharge.amountCents)}</b></div>`);
    $('#entitlementRows').innerHTML = entitlementRows.length ? entitlementRows.join('') : '<div class="finding-placeholder">Waiting for eligibility checks…</div>';

    const fixes = [];
    if (state.case.discoveries.creditChecked && outage.creditEligible) fixes.push({ label: 'Outage credit', amount: outage.creditCents, done: state.case.actions.outageCreditApplied });
    if (state.case.discoveries.chargeChecked && invalidCharge) fixes.push({ label: 'Incorrect installation fee', amount: invalidCharge.amountCents, done: state.case.actions.invalidChargeRefunded });
    const fixesReady = fixes.length === 2;
    show($('#fixCard'), fixesReady && state.case.status !== 'resolved');
    if (fixesReady) {
      const total = fixes.reduce((sum, item) => sum + item.amount, 0);
      $('#fixCount').textContent = String(fixes.length);
      $('#recoveryTotal').textContent = money(total);
      $('#fixRows').innerHTML = fixes.map((fix) => `<div class="fix-row"><span class="fix-icon ${fix.done ? 'done' : ''}">${fix.done ? '✓' : '+'}</span><div><strong>${fix.label}</strong><span>${fix.done ? 'Applied to account' : 'Verified and ready'}</span></div><b>+$${(fix.amount / 100).toFixed(2)}</b></div>`).join('');
      show($('#planOpportunity'), state.case.discoveries.plansReviewed);
      show($('#approvalActions'), !state.case.approval.billFixes);
      show($('#approvalNotice'), state.case.approval.billFixes);
      if (state.case.approval.billFixes) {
        $('#approvalNotice').innerHTML = state.case.approval.planId
          ? '<strong>Approved:</strong> billing fixes and Fiber 500 Flex. Your agent can now execute all three actions.'
          : '<strong>Approved:</strong> billing fixes only. Plan changes remain blocked.';
      }
    }

    show($('#receiptCard'), state.case.status === 'resolved');
    if (state.case.status === 'resolved') {
      const credit = state.ledger.find((entry) => entry.type === 'outage_credit');
      const refund = state.ledger.find((entry) => entry.type === 'charge_refund');
      const rows = [
        ['Previous bill', money(bill.originalAmountCents)],
        ['Outage credit', credit ? `−${money(Math.abs(credit.amountCents))}` : '$0.00'],
        ['Invalid fee refund', refund ? `−${money(Math.abs(refund.amountCents))}` : '$0.00'],
        ['New balance', money(balance)],
        ['Plan changed', state.case.actions.planChanged ? `Yes · ${state.plan.name}` : 'No']
      ];
      $('#receiptRows').innerHTML = rows.map(([label, value], index) => `<div class="receipt-row ${index === 3 ? 'total' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`).join('');
      $('#receiptCase').textContent = `Case ${state.case.id}`;
      const seconds = state.case.openedAt && state.case.resolvedAt ? Math.max(0, Math.round((new Date(state.case.resolvedAt) - new Date(state.case.openedAt)) / 1000)) : 0;
      $('#receiptTime').textContent = `Resolved in ${seconds}s`;
    }
  }

  function pushActivity(event) {
    activity.unshift(event);
    const log = $('#activityLog');
    log.innerHTML = activity.slice(0, 12).map((item) => `<li><span class="activity-marker ${item.type === 'human_approval' ? 'human' : item.type.startsWith('apply_') || item.type.startsWith('refund_') || item.type === 'change_plan' ? 'write' : ''}"></span><div><strong>${item.label}</strong><small>${new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></div></li>`).join('');
    $('#activityCount').textContent = `${activity.length} ${activity.length === 1 ? 'action' : 'actions'}`;
  }

  async function onEvent(event) {
    pushActivity(event);
    await render();
    const focusMap = {
      get_current_bill: '#billCard',
      compare_bills: '#resolutionCenter',
      get_outage_history: '#outageCard',
      check_credit_eligibility: '#resolutionCenter',
      check_charge_validity: '#resolutionCenter',
      list_plan_options: '#fixCard',
      get_resolution_summary: '#fixCard',
      apply_outage_credit: '#fixCard',
      refund_invalid_charge: '#fixCard',
      change_plan: '#fixCard',
      get_resolution_receipt: '#receiptCard',
      human_approval: '#fixCard'
    };
    const selector = focusMap[event.type];
    const target = selector ? $(selector) : null;
    if (target && !target.classList.contains('hidden')) {
      target.classList.add('pulse');
      setTimeout(() => target.classList.remove('pulse'), 900);
    }
  }

  function bindNavigation() {
    function activate(hash = location.hash || '#account') {
      const id = hash.replace('#', '') || 'account';
      $$('.page-section').forEach((section) => section.classList.toggle('active', section.id === id));
      $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.panel === id));
      $('#mainContent').scrollTop = 0;
    }
    window.addEventListener('hashchange', () => activate());
    activate();
  }

  function setWebMcpStatus({ supported, count = 0, error = null }) {
    const el = $('#webmcpStatus');
    el.classList.toggle('ready', supported);
    el.classList.toggle('error', Boolean(error));
    el.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${supported ? `WebMCP ready · ${count} tools` : error ? 'WebMCP registration error' : 'Portal ready · enable WebMCP'}`;
    el.title = error || (supported ? `${count} browser-native WebMCP tools registered` : 'Use ChatGPT in-app browser or Chrome with WebMCP enabled');
  }

  return { render, onEvent, bindNavigation, setWebMcpStatus };
}
