import { buildBillComparison, money, balanceCents } from './cloud.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const formatDate = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => value ? new Intl.DateTimeFormat(undefined, options).format(new Date(value)) : '—';
const formatDateOnly = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(Date.UTC(year, month - 1, day, 12)));
};
const currentBill = (state) => state.bills.find((bill) => bill.status === 'due') || state.bills[0];
const initials = (name) => String(name || 'A').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'A';

function show(el, visible = true) { el?.classList.toggle('hidden', !visible); }
function setText(selector, value) { const el = $(selector); if (el) el.textContent = value; }
function statusLabel(status) {
  return ({ idle: 'No active review', investigating: 'Investigating', approved: 'Approved', in_progress: 'Applying fixes', awaiting_plan_change: 'Bill fixed · plan pending', resolved: 'Resolved' })[status] || status;
}
function accountStatusLabel(status) { return status === 'good_standing' ? 'Good standing' : status?.replaceAll('_', ' ') || 'Active'; }
function greeting(name) {
  const hour = new Date().getHours();
  const prefix = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(name || '').trim().split(/\s+/)[0];
  return first ? `${prefix}, ${first}` : prefix;
}
function settingWord(value) { return value ? 'On' : 'Off'; }
function sanitizeStateCode(value) { return String(value || '').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase(); }

export function createUI({ service, auth, session, onSignOut }) {
  let state = null;
  let busy = false;
  let dialogResolver = null;

  function toast(message, kind = '') {
    const region = $('#toastRegion');
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.textContent = message;
    region.append(node);
    setTimeout(() => node.remove(), 4200);
  }

  function setBusy(value, except = null) {
    busy = value;
    $$('button').forEach((button) => {
      if (button === except || button.closest('#profileMenu')) return;
      if (button.dataset.permanentDisabled === 'true') return;
      button.disabled = value;
    });
  }

  async function runAction(fn, { success, button } = {}) {
    if (busy) return null;
    setBusy(true, button);
    if (button) button.disabled = true;
    try {
      const result = await fn();
      if (success) toast(success, 'success');
      await refresh();
      return result;
    } catch (error) {
      console.error(error);
      toast(error instanceof Error ? error.message : String(error), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openDialog({ title, message, details = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, infoOnly = false }) {
    const dialog = $('#confirmDialog');
    setText('#dialogTitle', title);
    setText('#dialogMessage', message);
    $('#dialogDetails').innerHTML = details;
    const confirm = $('#dialogConfirm');
    const cancel = $('#dialogCancel');
    confirm.textContent = infoOnly ? 'Close' : confirmLabel;
    confirm.className = `button ${danger ? 'danger' : 'primary'}`;
    cancel.textContent = cancelLabel;
    show(cancel, !infoOnly);
    if (!dialog.open) dialog.showModal();
    return new Promise((resolve) => {
      dialogResolver = resolve;
    });
  }

  function settleDialog(value) {
    if (dialogResolver) {
      dialogResolver(value);
      dialogResolver = null;
    }
  }

  function activatePanel(id) {
    const panel = document.getElementById(id) ? id : 'overview';
    $$('.page-section').forEach((section) => section.classList.toggle('active', section.id === panel));
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.panel === panel));
    if (location.hash !== `#${panel}`) history.replaceState(null, '', `#${panel}`);
    $('#sidebar').classList.remove('open');
    $('#mobileMenuButton').setAttribute('aria-expanded', 'false');
    $('#profileMenu').classList.add('hidden');
    $('#profileMenuButton').setAttribute('aria-expanded', 'false');
    $('#mainContent').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHeader() {
    const name = state.profile.fullName;
    const avatarText = initials(name);
    setText('#headerName', name);
    setText('#headerAccount', state.account.accountNumber);
    setText('#headerAvatar', avatarText);
    setText('#profileAvatar', avatarText);
    setText('#sidebarAccountNumber', state.account.accountNumber);
    setText('#sidebarServiceAddress', `${state.account.serviceAddress}, ${state.account.serviceCity}, ${state.account.serviceState} ${state.account.servicePostal}`);
    setText('#sidebarAccountStatus', accountStatusLabel(state.account.status));
    setText('#overviewTitle', greeting(name));
    setText('#overviewSubhead', `${state.plan.name} · Account ${state.account.accountNumber}`);
    setText('#accountState', accountStatusLabel(state.account.status));
  }

  function renderOverview() {
    const bill = currentBill(state);
    const previous = state.bills.find((item) => item.id !== bill.id);
    const comparison = buildBillComparison(state);
    const balance = balanceCents(state);
    const outage = state.outages[0];

    setText('#currentAmount', money(balance));
    setText('#previousAmount', money(previous?.originalAmountCents || 0));
    setText('#billDelta', `${comparison.deltaCents >= 0 ? '+' : '−'}${money(Math.abs(comparison.deltaCents))}`);
    setText('#billDueText', `Due ${formatDateOnly(bill.dueOn, { month: 'short', day: 'numeric' })}`);
    setText('#currentPlanName', state.plan.name);
    setText('#currentPlanSpeed', `${state.plan.speedMbps} Mbps · Unlimited data`);
    setText('#currentPlanPrice', `${money(state.plan.monthlyCents)}/mo`);
    setText('#promoMessage', state.plan.promoEndedOn ? `Promotional price ended ${formatDateOnly(state.plan.promoEndedOn, { month: 'short', day: 'numeric' })}` : 'Your current plan has no promotional expiration.');
    setText('#caseStatus', statusLabel(state.case.status));

    if (outage) {
      setText('#outageHeadline', outage.confirmed ? 'Outage confirmed' : 'Service event');
      setText('#outageSummary', `${formatDate(outage.startedAt, { weekday: 'long', month: 'short', day: 'numeric' })} · ${Math.floor(outage.durationMinutes / 60)}h ${outage.durationMinutes % 60}m · ${outage.reason}`);
    }

    const hasInvestigation = Object.values(state.case.discoveries || {}).some(Boolean);
    show($('#idleResolution'), !hasInvestigation && state.case.status === 'idle');
    show($('#investigationView'), hasInvestigation);

    const compareRows = [];
    if (state.case.discoveries.comparedBills) {
      for (const change of comparison.changes) {
        compareRows.push(`<div class="finding-row"><div><strong>${escapeHtml(change.label)}</strong><span>${escapeHtml(change.explanation)}</span></div><b>+${money(change.amountCents)}</b></div>`);
      }
    }
    $('#comparisonRows').innerHTML = compareRows.length ? compareRows.join('') : '<div class="finding-placeholder">Waiting for bill comparison…</div>';

    const entitlementRows = [];
    const invalidCharge = bill.charges.find((charge) => charge.valid === false);
    if (state.case.discoveries.creditChecked && outage) entitlementRows.push(`<div class="finding-row success"><div><strong>Outage service credit</strong><span>${outage.durationMinutes} minute confirmed outage · eligible</span></div><b>+${money(outage.creditCents)}</b></div>`);
    if (state.case.discoveries.chargeChecked && invalidCharge) entitlementRows.push(`<div class="finding-row success"><div><strong>Incorrect installation fee</strong><span>${escapeHtml(invalidCharge.invalidReason)}</span></div><b>+${money(invalidCharge.amountCents)}</b></div>`);
    $('#entitlementRows').innerHTML = entitlementRows.length ? entitlementRows.join('') : '<div class="finding-placeholder">Waiting for eligibility checks…</div>';

    const fixes = [];
    if (state.case.discoveries.creditChecked && outage?.creditEligible) fixes.push({ label: 'Outage credit', amount: outage.creditCents, done: state.case.actions.outageCreditApplied });
    if (state.case.discoveries.chargeChecked && invalidCharge) fixes.push({ label: 'Incorrect installation fee', amount: invalidCharge.amountCents, done: state.case.actions.invalidChargeRefunded });
    const fixesReady = fixes.length === 2;
    show($('#fixCard'), fixesReady && state.case.status !== 'resolved');
    if (fixesReady) {
      const total = fixes.reduce((sum, item) => sum + item.amount, 0);
      setText('#fixCount', fixes.length);
      setText('#recoveryTotal', money(total));
      $('#fixRows').innerHTML = fixes.map((fix) => `<div class="fix-row"><span class="fix-icon ${fix.done ? 'done' : ''}">${fix.done ? '✓' : '+'}</span><div><strong>${escapeHtml(fix.label)}</strong><span>${fix.done ? 'Applied to account' : 'Verified and ready'}</span></div><b>+${money(fix.amount)}</b></div>`).join('');
      const alt = state.planOptions.find((plan) => plan.equivalentToCurrent);
      show($('#planOpportunity'), state.case.discoveries.plansReviewed && Boolean(alt));
      if (alt) {
        setText('#resolutionCurrentPlan', `${money(state.plan.monthlyCents)}/mo`);
        setText('#resolutionAltPlan', `${money(alt.monthlyCents)}/mo`);
        setText('#resolutionSavings', `Save ${money(state.plan.monthlyCents - alt.monthlyCents)}/mo`);
      }
      $('#approveBillOnly').textContent = `Fix bill only — ${money(total)} recovered`;
      $('#approveBillAndPlan').textContent = alt ? `Fix bill + switch plan — save ${money(state.plan.monthlyCents - alt.monthlyCents)}/month` : 'Fix bill + switch plan';
      show($('#approvalActions'), !state.case.approval.billFixes);
      show($('#approvalNotice'), state.case.approval.billFixes);
      if (state.case.approval.billFixes) {
        $('#approvalNotice').innerHTML = state.case.approval.planId
          ? `<strong>Approved:</strong> billing fixes and ${escapeHtml(state.case.approval.planId)}. The selected actions are now authorized.`
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
      $('#receiptRows').innerHTML = rows.map(([label, value], index) => `<div class="receipt-row ${index === 3 ? 'total' : ''}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
      setText('#receiptCase', `Case ${state.case.id}`);
      const seconds = state.case.openedAt && state.case.resolvedAt ? Math.max(0, Math.round((new Date(state.case.resolvedAt) - new Date(state.case.openedAt)) / 1000)) : 0;
      setText('#receiptTime', `Resolved in ${seconds}s`);
    }

    const events = state.auditLog || [];
    setText('#activityCount', `${events.length} ${events.length === 1 ? 'action' : 'actions'}`);
    $('#activityLog').innerHTML = events.length ? events.slice(0, 15).map((item) => {
      const type = item.type || '';
      const marker = type === 'human_approval' || type === 'plan_approval' ? 'human' : type.startsWith('apply_') || type.startsWith('refund_') || type === 'change_plan' ? 'write' : '';
      return `<li><span class="activity-marker ${marker}"></span><div><strong>${escapeHtml(item.detail)}</strong><small>${formatDate(item.at, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</small></div></li>`;
    }).join('') : '<li class="activity-empty">No activity yet.</li>';
  }

  function renderBilling() {
    const bill = currentBill(state);
    const balance = balanceCents(state);
    setText('#statementDue', money(balance));
    setText('#statementTotal', money(balance));
    setText('#statementDueDate', `Due ${formatDateOnly(bill.dueOn)}`);
    setText('#billingAutopay', settingWord(state.account.autopay));
    setText('#billingPaperless', settingWord(state.account.paperless));
    $('#chargeRows').innerHTML = [
      ...bill.charges.map((charge) => `<div class="statement-line"><div><strong>${escapeHtml(charge.label)}</strong><small>${charge.category === 'service' ? 'Monthly service' : charge.category === 'one_time_fee' ? 'One-time charge' : 'Adjustment'}</small></div><span>${money(charge.amountCents)}</span></div>`),
      ...state.ledger.map((entry) => `<div class="statement-line adjustment"><div><strong>${escapeHtml(entry.label)}</strong><small>Account adjustment · ${formatDate(entry.createdAt, { month: 'short', day: 'numeric' })}</small></div><span>${money(entry.amountCents)}</span></div>`)
    ].join('');
    $('#statementHistory').innerHTML = state.bills.map((statement) => `<div class="list-row"><div class="list-row-main"><strong>${escapeHtml(statement.period)}</strong><small>Issued ${formatDateOnly(statement.issuedOn)} · ${escapeHtml(statement.status)}</small></div><div class="list-row-actions"><strong>${money(statement.originalAmountCents)}</strong><button class="text-button" type="button" data-statement-id="${escapeHtml(statement.id)}">View</button></div></div>`).join('');
  }

  function renderUsage() {
    const rows = state.usage || [];
    const current = rows[0] || { downloadGb: 0, uploadGb: 0, peakMbps: 0 };
    const total = Number(current.downloadGb) + Number(current.uploadGb);
    $('#usageCards').innerHTML = [
      ['Total data', `${total.toFixed(1)} GB`, 'Unlimited data included'],
      ['Download', `${Number(current.downloadGb).toFixed(1)} GB`, rows[0]?.period || 'Current period'],
      ['Peak speed', `${Number(current.peakMbps)} Mbps`, `${state.plan.speedMbps} Mbps plan`]
    ].map(([label, value, note]) => `<article class="card metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');
    const max = Math.max(1, ...rows.map((row) => Number(row.downloadGb) + Number(row.uploadGb)));
    $('#usageBars').innerHTML = rows.map((row) => {
      const value = Number(row.downloadGb) + Number(row.uploadGb);
      return `<div class="usage-bar-row"><strong>${escapeHtml(row.period)}</strong><div class="usage-track"><div class="usage-fill" style="width:${Math.max(2, Math.round((value / max) * 100))}%"></div></div><small>${value.toFixed(1)} GB</small></div>`;
    }).join('');
  }

  function renderOutages() {
    setText('#outageAddress', `Service events for ${state.account.serviceAddress}, ${state.account.serviceCity}.`);
    $('#outageHistory').innerHTML = state.outages.length ? state.outages.map((outage) => `<article class="outage-row"><div class="outage-date">${formatDate(outage.startedAt, { month: 'short', day: 'numeric' })}</div><div><strong>${escapeHtml(outage.reason)}</strong><small>${formatDate(outage.startedAt, { hour: 'numeric', minute: '2-digit' })} – ${formatDate(outage.endedAt, { hour: 'numeric', minute: '2-digit' })} · ${Math.floor(outage.durationMinutes / 60)}h ${outage.durationMinutes % 60}m</small></div><span class="warning-badge">${outage.confirmed ? 'Confirmed' : 'Reported'}</span></article>`).join('') : '<div class="list-row"><span>No outages found for this account.</span></div>';
  }

  function renderPlans() {
    const allPlans = [{ ...state.plan, data: 'Unlimited', contract: 'Month-to-month', current: true }, ...state.planOptions.map((plan) => ({ ...plan, current: false }))];
    $('#planGrid').innerHTML = allPlans.map((plan) => {
      const savings = state.plan.monthlyCents - plan.monthlyCents;
      return `<article class="card plan-option ${plan.current ? 'current' : ''}">${plan.current ? '<span class="plan-badge">Current plan</span>' : plan.equivalentToCurrent ? '<span class="plan-badge">Best equivalent</span>' : '<span class="plan-badge">Available</span>'}<div><h2>${escapeHtml(plan.name)}</h2><div class="plan-price">${money(plan.monthlyCents)}<small>/month</small></div></div><div class="plan-features"><span class="plan-feature">${Number(plan.speedMbps)} Mbps internet</span><span class="plan-feature">${escapeHtml(plan.data || 'Unlimited data')}</span><span class="plan-feature">${escapeHtml(plan.contract || 'Month-to-month')}</span>${savings > 0 ? `<span class="plan-feature">Save ${money(savings)} per month</span>` : ''}</div><button class="button ${plan.current ? 'secondary' : 'primary'} wide" type="button" ${plan.current ? 'disabled data-permanent-disabled="true"' : `data-plan-id="${escapeHtml(plan.id)}"`}>${plan.current ? 'Your current plan' : `Choose ${escapeHtml(plan.name)}`}</button></article>`;
    }).join('');
  }

  function renderSupport() {
    const tickets = state.tickets || [];
    $('#ticketList').innerHTML = tickets.length ? tickets.map((ticket) => `<div class="list-row"><div class="list-row-main"><strong>${escapeHtml(ticket.subject)}</strong><small>${escapeHtml(ticket.category)} · ${formatDate(ticket.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div><span class="ticket-status">${escapeHtml(ticket.status)}</span></div>`).join('') : '<div class="list-row"><div class="list-row-main"><strong>No open requests</strong><small>New support requests will appear here.</small></div></div>';
  }

  function renderForms() {
    const email = session?.user?.email || '';
    setText('#profileDisplayName', state.profile.fullName);
    setText('#profileEmail', email);
    setText('#profileAccountNumber', state.account.accountNumber);
    if (!$('#profileForm').contains(document.activeElement)) {
      $('#profileName').value = state.profile.fullName || '';
      $('#profileEmailInput').value = email;
      $('#profilePhone').value = state.profile.phone || '';
      $('#serviceAddress').value = state.account.serviceAddress || '';
      $('#serviceCity').value = state.account.serviceCity || '';
      $('#serviceState').value = state.account.serviceState || '';
      $('#servicePostal').value = state.account.servicePostal || '';
      $('#profileTimezone').value = state.profile.timezone || 'UTC';
    }
    if (!$('#settings').contains(document.activeElement)) {
      $('#autopayToggle').checked = Boolean(state.account.autopay);
      $('#paperlessToggle').checked = Boolean(state.account.paperless);
      $('#billingAlertsToggle').checked = Boolean(state.profile.billingAlerts);
      $('#serviceUpdatesToggle').checked = Boolean(state.profile.serviceUpdates);
    }
    show($('#resetDemo'), Boolean(state.profile.isDemo));
  }

  function render() {
    renderHeader();
    renderOverview();
    renderBilling();
    renderUsage();
    renderOutages();
    renderPlans();
    renderSupport();
    renderForms();
  }

  async function refresh() {
    state = await service.getState();
    render();
    return state;
  }

  function profileArgs(overrides = {}) {
    return {
      p_full_name: overrides.fullName ?? state.profile.fullName,
      p_phone: overrides.phone ?? state.profile.phone ?? '',
      p_timezone: overrides.timezone ?? state.profile.timezone ?? 'UTC',
      p_service_address: overrides.serviceAddress ?? state.account.serviceAddress,
      p_service_city: overrides.serviceCity ?? state.account.serviceCity,
      p_service_state: overrides.serviceState ?? state.account.serviceState,
      p_service_postal: overrides.servicePostal ?? state.account.servicePostal,
      p_autopay: overrides.autopay ?? state.account.autopay,
      p_paperless: overrides.paperless ?? state.account.paperless,
      p_billing_alerts: overrides.billingAlerts ?? state.profile.billingAlerts,
      p_service_updates: overrides.serviceUpdates ?? state.profile.serviceUpdates
    };
  }

  async function onEvent(event) {
    await refresh();
    const focusMap = { compare_bills: '#resolutionCenter', check_credit_eligibility: '#resolutionCenter', check_charge_validity: '#resolutionCenter', list_plan_options: '#fixCard', apply_outage_credit: '#fixCard', refund_invalid_charge: '#fixCard', change_plan: '#plans', human_approval: '#fixCard' };
    const target = $(focusMap[event.type]);
    if (target && !target.classList.contains('hidden')) {
      target.classList.add('pulse');
      setTimeout(() => target.classList.remove('pulse'), 850);
    }
  }

  function setWebMcpStatus(status) {
    const pill = $('#webMcpStatus');
    const copy = pill.querySelector('span:last-child');
    if (status.supported) {
      pill.classList.add('ready');
      copy.textContent = `WebMCP ready · ${status.count} tools`;
    } else {
      pill.classList.remove('ready');
      copy.textContent = 'Browser tools unavailable';
    }
  }

  function bindNavigation() {
    window.addEventListener('hashchange', () => activatePanel((location.hash || '#overview').slice(1)));
    document.addEventListener('click', (event) => {
      const go = event.target.closest('[data-go]');
      if (go) {
        event.preventDefault();
        activatePanel(go.dataset.go);
      }
    });
    $$('.nav-item').forEach((item) => item.addEventListener('click', () => activatePanel(item.dataset.panel)));
    activatePanel((location.hash || '#overview').slice(1));
  }

  function bindControls() {
    $('#mobileMenuButton').addEventListener('click', () => {
      const sidebar = $('#sidebar');
      const open = sidebar.classList.toggle('open');
      $('#mobileMenuButton').setAttribute('aria-expanded', String(open));
    });
    $('#profileMenuButton').addEventListener('click', () => {
      const menu = $('#profileMenu');
      const open = menu.classList.toggle('hidden') === false;
      $('#profileMenuButton').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.profile-menu-wrap')) {
        $('#profileMenu').classList.add('hidden');
        $('#profileMenuButton').setAttribute('aria-expanded', 'false');
      }
    });

    $('#confirmDialog').addEventListener('close', () => settleDialog($('#confirmDialog').returnValue === 'confirm'));

    const signOut = async () => {
      if (busy) return;
      setBusy(true);
      try { await auth.signOut(); } finally { setBusy(false); onSignOut?.(); }
    };
    $('#menuSignOut').addEventListener('click', signOut);
    $('#settingsSignOut').addEventListener('click', signOut);

    $('#runGuidedReview').addEventListener('click', (event) => runAction(async () => {
      const bill = await service.getCurrentBill();
      await service.compareBills();
      const outages = await service.getOutageHistory();
      if (outages[0]) await service.checkCreditEligibility({ outage_id: outages[0].outage_id });
      const current = await service.getState();
      const invalid = currentBill(current).charges.find((charge) => charge.valid === false);
      if (invalid) await service.checkChargeValidity({ charge_id: invalid.id });
      await service.listPlanOptions();
      await service.getResolutionSummary();
      return bill;
    }, { success: 'Review complete. Verified fixes are ready for your approval.', button: event.currentTarget }));

    $('#approveBillOnly').addEventListener('click', async (event) => {
      const ok = await openDialog({ title: 'Apply the verified bill fixes?', message: 'This will add the outage credit and refund the invalid installation fee. Your plan will not change.', details: `<strong>Total recovery:</strong> $23.17<br><strong>Expected new balance:</strong> $71.20`, confirmLabel: 'Fix my bill' });
      if (!ok) return;
      await runAction(async () => {
        await service.approveResolution({ includePlan: false });
        const fresh = await service.getState();
        await service.applyOutageCredit({ outage_id: fresh.outages[0].id });
        const invalid = currentBill(fresh).charges.find((charge) => charge.valid === false);
        await service.refundInvalidCharge({ charge_id: invalid.id });
      }, { success: 'Bill fixed. $23.17 was recovered and your plan was left unchanged.', button: event.currentTarget });
    });

    $('#approveBillAndPlan').addEventListener('click', async (event) => {
      const fresh = await service.getState();
      const alt = fresh.planOptions.find((plan) => plan.equivalentToCurrent) || fresh.planOptions[0];
      if (!alt) return toast('No alternative plan is available.', 'error');
      const ok = await openDialog({ title: `Fix the bill and switch to ${alt.name}?`, message: 'You are approving the verified billing recovery and this exact plan change.', details: `<strong>Bill recovery:</strong> $23.17<br><strong>New monthly price:</strong> ${money(alt.monthlyCents)}<br><strong>Monthly savings:</strong> ${money(fresh.plan.monthlyCents - alt.monthlyCents)}`, confirmLabel: 'Approve fixes + plan' });
      if (!ok) return;
      await runAction(async () => {
        await service.approveResolution({ includePlan: true, planId: alt.id });
        const latest = await service.getState();
        await service.applyOutageCredit({ outage_id: latest.outages[0].id });
        const invalid = currentBill(latest).charges.find((charge) => charge.valid === false);
        await service.refundInvalidCharge({ charge_id: invalid.id });
        await service.changePlan({ plan_id: alt.id });
      }, { success: `Bill fixed and plan changed to ${alt.name}.`, button: event.currentTarget });
    });

    $('#reviewOutageCredit').addEventListener('click', (event) => runAction(async () => {
      const outages = await service.getOutageHistory();
      if (!outages[0]) throw new Error('No outage history is available.');
      const result = await service.checkCreditEligibility({ outage_id: outages[0].outage_id });
      activatePanel('overview');
      return result;
    }, { success: 'Outage credit eligibility verified.', button: event.currentTarget }));

    $('#planGrid').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-plan-id]');
      if (!button) return;
      const plan = state.planOptions.find((item) => item.id === button.dataset.planId);
      if (!plan) return;
      const savings = state.plan.monthlyCents - plan.monthlyCents;
      const ok = await openDialog({ title: `Switch to ${plan.name}?`, message: 'Plan changes require explicit approval. This confirmation applies only to this selected plan.', details: `<strong>Speed:</strong> ${plan.speedMbps} Mbps<br><strong>Monthly price:</strong> ${money(plan.monthlyCents)}${savings > 0 ? `<br><strong>You save:</strong> ${money(savings)}/month` : ''}`, confirmLabel: 'Change plan' });
      if (!ok) return;
      await runAction(async () => {
        await service.approvePlanChange(plan.id);
        await service.changePlan({ plan_id: plan.id });
      }, { success: `Plan changed to ${plan.name}.`, button });
    });

    $('#supportForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const subject = $('#supportSubject').value.trim();
      const message = $('#supportMessage').value.trim();
      if (subject.length < 3 || message.length < 10) return toast('Add a subject and a little more detail.', 'error');
      runAction(() => service.createSupportTicket({ category: $('#supportCategory').value, subject, message }), { success: 'Support request submitted.', button: event.submitter }).then((result) => {
        if (result) event.currentTarget.reset();
      });
    });

    $('#profileForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const fullName = $('#profileName').value.trim();
      const serviceState = sanitizeStateCode($('#serviceState').value);
      if (fullName.length < 2) return toast('Enter your full name.', 'error');
      if (!$('#serviceAddress').value.trim() || !$('#serviceCity').value.trim() || !serviceState || !$('#servicePostal').value.trim()) return toast('Complete your service address.', 'error');
      runAction(() => service.updateProfile(profileArgs({ fullName, phone: $('#profilePhone').value.trim(), timezone: $('#profileTimezone').value, serviceAddress: $('#serviceAddress').value.trim(), serviceCity: $('#serviceCity').value.trim(), serviceState, servicePostal: $('#servicePostal').value.trim() })), { success: 'Profile saved.', button: event.submitter });
    });

    $('#saveBillingSettings').addEventListener('click', (event) => runAction(() => service.updateProfile(profileArgs({ autopay: $('#autopayToggle').checked, paperless: $('#paperlessToggle').checked })), { success: 'Billing preferences saved.', button: event.currentTarget }));
    $('#saveNotificationSettings').addEventListener('click', (event) => runAction(() => service.updateProfile(profileArgs({ billingAlerts: $('#billingAlertsToggle').checked, serviceUpdates: $('#serviceUpdatesToggle').checked })), { success: 'Notification preferences saved.', button: event.currentTarget }));

    $('#passwordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentPassword = $('#currentPassword').value;
      const newPassword = $('#newPassword').value;
      if (newPassword.length < 10) return toast('Use at least 10 characters for the new password.', 'error');
      if (newPassword !== $('#confirmNewPassword').value) return toast('The new passwords do not match.', 'error');
      const result = await runAction(() => auth.changePassword({ currentPassword, newPassword }), { success: 'Password changed.', button: event.submitter });
      if (result !== null) event.currentTarget.reset();
    });

    $('#resetDemo').addEventListener('click', async (event) => {
      const ok = await openDialog({ title: 'Reset this demo account?', message: 'This restores the original bill, plan, approvals, support requests, and activity for this isolated demo login.', details: 'Your login and profile remain available.', confirmLabel: 'Reset demo', danger: true });
      if (!ok) return;
      await runAction(() => service.resetDemo(), { success: 'Demo billing scenario reset.', button: event.currentTarget });
      activatePanel('overview');
    });

    const printCurrent = () => window.print();
    $('#printStatement').addEventListener('click', () => { activatePanel('billing'); setTimeout(printCurrent, 80); });
    $('#printReceipt').addEventListener('click', () => { activatePanel('overview'); setTimeout(printCurrent, 80); });

    $('#statementHistory').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-statement-id]');
      if (!button) return;
      const bill = state.bills.find((item) => item.id === button.dataset.statementId);
      if (!bill) return;
      const rows = bill.charges.map((charge) => `<div class="statement-line"><div><strong>${escapeHtml(charge.label)}</strong><small>${escapeHtml(charge.category.replaceAll('_', ' '))}</small></div><span>${money(charge.amountCents)}</span></div>`).join('');
      await openDialog({ title: `${bill.period} statement`, message: `Issued ${formatDateOnly(bill.issuedOn)} · ${bill.status}`, details: `${rows}<div class="statement-total"><span>Statement total</span><strong>${money(bill.originalAmountCents)}</strong></div>`, infoOnly: true });
    });
  }

  async function init() {
    bindNavigation();
    bindControls();
    await refresh();
  }

  return { init, refresh, onEvent, setWebMcpStatus, toast, activatePanel };
}
