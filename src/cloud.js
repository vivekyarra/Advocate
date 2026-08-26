const AUTH_BASE_URL = 'https://ep-flat-king-au0nxtti.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth';
const DATA_API_URL = 'https://ep-flat-king-au0nxtti.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1';

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const currentBill = (state) => state.bills.find((bill) => bill.status === 'due') || state.bills[0];
const previousBill = (state) => state.bills.find((bill) => bill.id !== currentBill(state)?.id);
const balanceCents = (state) => Number(state.balanceCents ?? (currentBill(state)?.originalAmountCents || 0) + state.ledger.reduce((sum, entry) => sum + entry.amountCents, 0));

function parseError(data, response) {
  const message = data?.message || data?.error?.message || data?.error || data?.details || `Request failed (${response.status})`;
  return new Error(typeof message === 'string' ? message : JSON.stringify(message));
}

export class AdvocateAuthClient {
  constructor(baseURL = AUTH_BASE_URL, storage = globalThis.sessionStorage) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.storage = storage;
    this.sessionToken = storage?.getItem?.('advocate_session_token') || null;
    this.jwtToken = null;
  }

  async #request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      mode: 'cors'
    });
    let data = null;
    const text = await response.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }
    if (!response.ok) throw parseError(data, response);
    const responseSessionToken = data?.token || response.headers.get('set-auth-token');
    const responseJwt = response.headers.get('set-auth-jwt');
    if (responseSessionToken && !String(responseSessionToken).includes('.')) {
      this.sessionToken = responseSessionToken;
      this.storage?.setItem?.('advocate_session_token', responseSessionToken);
    }
    if (responseJwt) this.jwtToken = responseJwt;
    return { data, response };
  }

  async signUp({ name, email, password }) {
    const { data } = await this.#request('/sign-up/email', { method: 'POST', body: { name, email, password }, auth: false });
    if (data?.token) {
      this.sessionToken = data.token;
      this.storage?.setItem?.('advocate_session_token', data.token);
    }
    return data;
  }

  async signIn({ email, password, rememberMe = true }) {
    const { data } = await this.#request('/sign-in/email', { method: 'POST', body: { email, password, rememberMe }, auth: false });
    if (data?.token) {
      this.sessionToken = data.token;
      this.storage?.setItem?.('advocate_session_token', data.token);
    }
    return data;
  }

  async getSession() {
    try {
      const { data } = await this.#request('/get-session');
      return data;
    } catch {
      return null;
    }
  }

  async getJwt({ force = false } = {}) {
    if (this.jwtToken && !force) return this.jwtToken;
    const { data } = await this.#request('/token');
    if (!data?.token) throw new Error('Could not create a secure account access token.');
    this.jwtToken = data.token;
    return this.jwtToken;
  }

  async signOut() {
    try { await this.#request('/sign-out', { method: 'POST', body: {} }); } finally {
      this.sessionToken = null;
      this.jwtToken = null;
      this.storage?.removeItem?.('advocate_session_token');
    }
  }

  async changePassword({ currentPassword, newPassword }) {
    const { data } = await this.#request('/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword, revokeOtherSessions: false }
    });
    return data;
  }
}

export class DataApiClient {
  constructor(getToken, baseURL = DATA_API_URL) {
    this.getToken = getToken;
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  async rpc(name, args = {}) {
    const token = await this.getToken();
    const response = await fetch(`${this.baseURL}/rpc/${name}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(args),
      mode: 'cors'
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }
    if (!response.ok) throw parseError(data, response);
    return data;
  }
}

export function buildBillComparison(state) {
  const current = currentBill(state);
  const previous = previousBill(state);
  const previousPromo = previous?.charges?.find((charge) => charge.category === 'discount');
  const install = current?.charges?.find((charge) => charge.category === 'one_time_fee');
  const changes = [];
  if (previousPromo) changes.push({ id: 'promo_expired', label: 'Promotional discount expired', amountCents: Math.abs(previousPromo.amountCents), explanation: 'Your 12-month $25 promotional discount ended on August 1.' });
  if (install) changes.push({ id: install.id, label: install.label, amountCents: install.amountCents, explanation: 'A one-time installation fee appeared on this statement.' });
  return {
    currentBillId: current?.id,
    previousBillId: previous?.id,
    currentAmountCents: balanceCents(state),
    previousAmountCents: previous?.originalAmountCents || 0,
    deltaCents: (current?.originalAmountCents || 0) - (previous?.originalAmountCents || 0),
    changes
  };
}

export function createCloudAdvocateService(api, hooks = {}) {
  const emit = (event) => hooks.onEvent?.({ ...event, at: new Date().toISOString() });
  const state = () => api.rpc('get_app_state');
  const activity = (type, label, metadata = {}) => api.rpc('record_activity', { p_type: type, p_detail: label, p_metadata: metadata });
  const discovery = (key, label) => api.rpc('record_discovery', { p_key: key, p_detail: label });

  async function withReadEvent(type, label, producer, discoveryKey = null) {
    const snapshot = await state();
    const result = producer(snapshot);
    if (discoveryKey) await discovery(discoveryKey, label);
    else await activity(type, label);
    emit({ type, label, result });
    return result;
  }

  return {
    getState: state,

    async getCurrentBill() {
      return withReadEvent('get_current_bill', 'Opened current bill', (s) => {
        const bill = currentBill(s);
        return { bill_id: bill.id, period: bill.period, amount_due_cents: balanceCents(s), amount_due: money(balanceCents(s)), due_on: bill.dueOn, status: bill.status, plan: s.plan.name };
      });
    },

    async getPreviousBills() {
      return withReadEvent('get_previous_bills', 'Loaded previous statements', (s) => s.bills.filter((bill) => bill.status !== 'due').map((bill) => ({ bill_id: bill.id, period: bill.period, amount_cents: bill.originalAmountCents, amount: money(bill.originalAmountCents), status: bill.status })));
    },

    async compareBills() {
      return withReadEvent('compare_bills', 'Compared August with July', buildBillComparison, 'comparedBills');
    },

    async getOutageHistory() {
      return withReadEvent('get_outage_history', 'Checked outage history', (s) => s.outages.map((outage) => ({ outage_id: outage.id, started_at: outage.startedAt, ended_at: outage.endedAt, duration_minutes: outage.durationMinutes, confirmed: outage.confirmed, reason: outage.reason })), 'outageReviewed');
    },

    async explainCharge({ charge_id } = {}) {
      if (!charge_id) throw new Error('charge_id is required.');
      return withReadEvent('explain_charge', `Explained charge ${charge_id}`, (s) => {
        const charge = currentBill(s).charges.find((item) => item.id === charge_id);
        if (!charge) throw new Error(`Charge ${charge_id} was not found on the current bill.`);
        return { charge_id: charge.id, label: charge.label, amount_cents: charge.amountCents, amount: money(charge.amountCents), category: charge.category, explanation: charge.category === 'one_time_fee' ? 'A one-time installation fee was added to the August statement.' : 'Recurring monthly service charge.' };
      });
    },

    async checkCreditEligibility({ outage_id } = {}) {
      if (!outage_id) throw new Error('outage_id is required.');
      return withReadEvent('check_credit_eligibility', 'Verified outage credit eligibility', (s) => {
        const outage = s.outages.find((item) => item.id === outage_id);
        if (!outage) throw new Error(`Outage ${outage_id} was not found.`);
        return { outage_id: outage.id, eligible: outage.confirmed && outage.creditEligible, credit_cents: outage.creditCents, credit: money(outage.creditCents), policy: outage.policy };
      }, 'creditChecked');
    },

    async checkChargeValidity({ charge_id } = {}) {
      if (!charge_id) throw new Error('charge_id is required.');
      return withReadEvent('check_charge_validity', 'Validated installation fee', (s) => {
        const charge = currentBill(s).charges.find((item) => item.id === charge_id);
        if (!charge) throw new Error(`Charge ${charge_id} was not found.`);
        return { charge_id: charge.id, valid: charge.valid, refundable: charge.valid === false, refund_cents: charge.valid === false ? charge.amountCents : 0, refund: charge.valid === false ? money(charge.amountCents) : '$0.00', reason: charge.invalidReason || 'Charge matches account activity.' };
      }, 'chargeChecked');
    },

    async listPlanOptions() {
      return withReadEvent('list_plan_options', 'Checked equivalent plan options', (s) => ({
        current_plan: { id: s.plan.id, name: s.plan.name, speed_mbps: s.plan.speedMbps, monthly_cents: s.plan.monthlyCents, monthly: money(s.plan.monthlyCents) },
        options: s.planOptions.map((plan) => ({ id: plan.id, name: plan.name, speed_mbps: plan.speedMbps, monthly_cents: plan.monthlyCents, monthly: money(plan.monthlyCents), monthly_savings_cents: s.plan.monthlyCents - plan.monthlyCents, equivalent_to_current: plan.equivalentToCurrent, contract: plan.contract }))
      }), 'plansReviewed');
    },

    async getApprovalStatus() {
      return withReadEvent('get_approval_status', 'Checked human approval', (s) => ({ bill_fixes_approved: s.case.approval.billFixes, approved_plan_id: s.case.approval.planId, status: s.case.status }));
    },

    async getResolutionSummary() {
      return withReadEvent('get_resolution_summary', 'Prepared resolution summary', (s) => {
        const outage = s.outages[0];
        const charge = currentBill(s).charges.find((item) => item.valid === false);
        const fixes = [];
        if (s.case.discoveries.creditChecked && outage?.creditEligible) fixes.push({ type: 'outage_credit', amount_cents: outage.creditCents, amount: money(outage.creditCents) });
        if (s.case.discoveries.chargeChecked && charge) fixes.push({ type: 'invalid_charge_refund', charge_id: charge.id, amount_cents: charge.amountCents, amount: money(charge.amountCents) });
        const recovery = fixes.reduce((sum, fix) => sum + fix.amount_cents, 0);
        const alt = s.planOptions.find((plan) => plan.equivalentToCurrent);
        return { fixes, total_recovery_cents: recovery, total_recovery: money(recovery), current_balance_cents: balanceCents(s), projected_balance_after_fixes_cents: balanceCents(s) - recovery, plan_opportunity: s.case.discoveries.plansReviewed && alt ? { current_monthly_cents: s.plan.monthlyCents, equivalent_plan_id: alt.id, equivalent_monthly_cents: alt.monthlyCents, monthly_savings_cents: s.plan.monthlyCents - alt.monthlyCents } : null, human_approval: { bill_fixes: s.case.approval.billFixes, plan_id: s.case.approval.planId } };
      });
    },

    async approveResolution({ includePlan = false, planId = 'fiber-500-flex' } = {}) {
      const result = await api.rpc('grant_resolution_approval', { p_include_plan: includePlan, p_plan_id: planId });
      emit({ type: 'human_approval', label: includePlan ? 'Customer approved bill fixes + plan switch' : 'Customer approved bill fixes only', result });
      return result;
    },

    async applyOutageCredit({ outage_id } = {}) {
      if (!outage_id) throw new Error('outage_id is required.');
      const result = await api.rpc('apply_outage_credit', { p_outage_id: outage_id });
      const formatted = { ...result, amount: money(result.amount_cents), balance: money(result.balance_cents) };
      emit({ type: 'apply_outage_credit', label: result.applied ? 'Applied $12.80 outage credit' : 'Confirmed outage credit already applied', result: formatted });
      return formatted;
    },

    async refundInvalidCharge({ charge_id } = {}) {
      if (!charge_id) throw new Error('charge_id is required.');
      const result = await api.rpc('refund_invalid_charge', { p_charge_id: charge_id });
      const formatted = { ...result, amount: money(result.amount_cents), balance: money(result.balance_cents) };
      emit({ type: 'refund_invalid_charge', label: result.refunded ? 'Refunded $10.37 installation fee' : 'Confirmed installation fee already refunded', result: formatted });
      return formatted;
    },

    async changePlan({ plan_id } = {}) {
      if (!plan_id) throw new Error('plan_id is required.');
      const result = await api.rpc('change_plan', { p_plan_id: plan_id });
      emit({ type: 'change_plan', label: result.changed ? `Changed plan to ${plan_id}` : 'Confirmed selected plan already active', result });
      return result;
    },

    async getResolutionReceipt() {
      return withReadEvent('get_resolution_receipt', 'Read resolution receipt', (s) => {
        if (s.case.status !== 'resolved') return { resolved: false, case_id: s.case.id, status: s.case.status };
        const bill = currentBill(s);
        const credit = s.ledger.find((entry) => entry.type === 'outage_credit');
        const refund = s.ledger.find((entry) => entry.type === 'charge_refund');
        const elapsed = s.case.openedAt && s.case.resolvedAt ? Math.max(0, Math.round((new Date(s.case.resolvedAt) - new Date(s.case.openedAt)) / 1000)) : 0;
        return { resolved: true, case_id: s.case.id, original_bill_cents: bill.originalAmountCents, outage_credit_cents: Math.abs(credit?.amountCents || 0), refund_cents: Math.abs(refund?.amountCents || 0), new_balance_cents: balanceCents(s), plan_changed: Boolean(s.case.actions.planChanged), current_plan: s.plan.name, elapsed_seconds: elapsed };
      });
    },

    approvePlanChange(planId) { return api.rpc('approve_plan_change', { p_plan_id: planId }); },
    updateProfile(args) { return api.rpc('update_account_profile', args); },
    createSupportTicket({ category, subject, message }) { return api.rpc('create_support_ticket', { p_category: category, p_subject: subject, p_message: message }); },
    recordActivity(type, detail, metadata = {}) { return activity(type, detail, metadata); },
    resetDemo() { return api.rpc('reset_demo_account'); }
  };
}

export { AUTH_BASE_URL, DATA_API_URL, money, balanceCents };
