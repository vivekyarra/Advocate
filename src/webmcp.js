const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const readOnlyAnnotations = { readOnlyHint: true, untrustedContentHint: false };
const writeAnnotations = { readOnlyHint: false, untrustedContentHint: false };

function stringify(result) {
  return JSON.stringify(result);
}

function chargeCandidates(comparison = {}) {
  return (comparison.changes || []).filter((change) => change?.id && change.id !== 'promo_expired');
}

async function investigateBillIssue(service) {
  const currentBill = await service.getCurrentBill();
  const previousBills = await service.getPreviousBills();
  const comparison = await service.compareBills();
  const outages = await service.getOutageHistory();

  const outageCredits = [];
  for (const outage of outages) {
    if (!outage.confirmed) continue;
    const eligibility = await service.checkCreditEligibility({ outage_id: outage.outage_id });
    if (eligibility.eligible) outageCredits.push(eligibility);
  }

  const invalidCharges = [];
  for (const candidate of chargeCandidates(comparison)) {
    const validity = await service.checkChargeValidity({ charge_id: candidate.id });
    if (validity.refundable) invalidCharges.push(validity);
  }

  await service.listPlanOptions();
  const summary = await service.getResolutionSummary();

  return {
    current_bill: {
      amount_due_cents: currentBill.amount_due_cents,
      amount_due: currentBill.amount_due,
      due_on: currentBill.due_on,
      plan: currentBill.plan
    },
    previous_bill: previousBills[0] || null,
    bill_changes: comparison.changes || [],
    eligible_outage_credits: outageCredits.map((item) => ({
      outage_id: item.outage_id,
      credit_cents: item.credit_cents,
      credit: item.credit,
      policy: item.policy
    })),
    invalid_charges: invalidCharges.map((item) => ({
      charge_id: item.charge_id,
      refund_cents: item.refund_cents,
      refund: item.refund,
      reason: item.reason
    })),
    total_recovery_cents: summary.total_recovery_cents,
    total_recovery: summary.total_recovery,
    projected_balance_after_fixes_cents: summary.projected_balance_after_fixes_cents,
    plan_opportunity: summary.plan_opportunity,
    human_approval: summary.human_approval,
    next_step: 'Present these verified findings to the customer and wait for their resolution choice in the page before applying any account-changing action.'
  };
}

async function applyApprovedResolution(service) {
  const approval = await service.getApprovalStatus();
  if (!approval.bill_fixes_approved) {
    throw new Error('Human approval required. Ask the customer to review the verified resolution in the page and choose a resolution option before applying account changes.');
  }

  const actions = { outage_credits: [], refunds: [], plan_change: null };
  const outages = await service.getOutageHistory();
  for (const outage of outages) {
    if (!outage.confirmed) continue;
    const eligibility = await service.checkCreditEligibility({ outage_id: outage.outage_id });
    if (!eligibility.eligible) continue;
    actions.outage_credits.push(await service.applyOutageCredit({ outage_id: outage.outage_id }));
  }

  const comparison = await service.compareBills();
  for (const candidate of chargeCandidates(comparison)) {
    const validity = await service.checkChargeValidity({ charge_id: candidate.id });
    if (!validity.refundable) continue;
    actions.refunds.push(await service.refundInvalidCharge({ charge_id: candidate.id }));
  }

  if (approval.approved_plan_id) {
    actions.plan_change = await service.changePlan({ plan_id: approval.approved_plan_id });
  }

  const receipt = await service.getResolutionReceipt();
  return {
    applied: true,
    billing_changes: actions.outage_credits.length + actions.refunds.length,
    plan_change_requested: Boolean(approval.approved_plan_id),
    plan_changed: Boolean(actions.plan_change?.changed),
    receipt
  };
}

export function createToolDefinitions(service) {
  return [
    {
      name: 'investigate_bill_issue',
      title: 'Investigate bill issue',
      description: 'Investigate an unusually high bill or outage end-to-end: compare statements, verify outage credits, validate suspicious charges, and identify an equivalent lower-cost plan. Read-only. Use this first for billing complaints, then ask the customer to approve a resolution in the page.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await investigateBillIssue(service))
    },
    {
      name: 'get_current_bill',
      title: 'Get current bill',
      description: 'Read the customer’s current bill, amount due, due date, status, and active plan.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.getCurrentBill())
    },
    {
      name: 'get_previous_bills',
      title: 'Get previous bills',
      description: 'Read previous billing statements so the agent can compare the current bill with recent history.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.getPreviousBills())
    },
    {
      name: 'compare_bills',
      title: 'Compare bills',
      description: 'Compare the current and previous bill and return the exact line-item changes that explain the difference.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.compareBills())
    },
    {
      name: 'get_outage_history',
      title: 'Get outage history',
      description: 'Read confirmed service outages for this account, including duration and event identifiers used for eligibility checks.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.getOutageHistory())
    },
    {
      name: 'explain_charge',
      title: 'Explain a charge',
      description: 'Explain one charge on the current bill by charge ID, including its amount and charge category.',
      inputSchema: {
        type: 'object',
        properties: { charge_id: { type: 'string', description: 'Charge ID returned by bill comparison or the current statement.' } },
        required: ['charge_id'], additionalProperties: false
      },
      annotations: readOnlyAnnotations,
      execute: async (input) => stringify(await service.explainCharge(input))
    },
    {
      name: 'check_credit_eligibility',
      title: 'Check outage credit',
      description: 'Check whether a confirmed outage qualifies for a service credit and return the exact eligible amount and policy.',
      inputSchema: {
        type: 'object',
        properties: { outage_id: { type: 'string', description: 'Outage ID returned by get_outage_history.' } },
        required: ['outage_id'], additionalProperties: false
      },
      annotations: readOnlyAnnotations,
      execute: async (input) => stringify(await service.checkCreditEligibility(input))
    },
    {
      name: 'check_charge_validity',
      title: 'Validate a charge',
      description: 'Validate whether a charge matches account activity and return whether it is refundable, with the exact refund amount.',
      inputSchema: {
        type: 'object',
        properties: { charge_id: { type: 'string', description: 'Charge ID returned by compare_bills or the current statement.' } },
        required: ['charge_id'], additionalProperties: false
      },
      annotations: readOnlyAnnotations,
      execute: async (input) => stringify(await service.checkChargeValidity(input))
    },
    {
      name: 'list_plan_options',
      title: 'List plan options',
      description: 'List the current plan and available alternatives, including equivalent-speed options and monthly savings. Does not change the plan.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.listPlanOptions())
    },
    {
      name: 'get_resolution_summary',
      title: 'Get resolution summary',
      description: 'Summarize verified fixes, recovery amount, projected balance, plan opportunity, and current human approval scope.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.getResolutionSummary())
    },
    {
      name: 'get_approval_status',
      title: 'Get approval status',
      description: 'Read which billing fixes and plan change, if any, the customer has explicitly approved in the page.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.getApprovalStatus())
    },
    {
      name: 'apply_approved_resolution',
      title: 'Apply approved resolution',
      description: 'Apply only the resolution the customer already approved in the page: eligible outage credits, invalid-charge refunds, and an exactly approved plan change if present. Backend controls re-check approval and idempotency. Never use before the customer approves.',
      inputSchema: emptySchema,
      annotations: writeAnnotations,
      execute: async () => stringify(await applyApprovedResolution(service))
    },
    {
      name: 'apply_outage_credit',
      title: 'Apply outage credit',
      description: 'Apply an eligible outage service credit to the actual account ledger. Fails unless the customer approved billing fixes in the page.',
      inputSchema: {
        type: 'object',
        properties: { outage_id: { type: 'string', description: 'Eligible outage ID returned by check_credit_eligibility.' } },
        required: ['outage_id'], additionalProperties: false
      },
      annotations: writeAnnotations,
      execute: async (input) => stringify(await service.applyOutageCredit(input))
    },
    {
      name: 'refund_invalid_charge',
      title: 'Refund invalid charge',
      description: 'Refund a verified invalid charge to the actual account ledger. Fails unless the customer approved billing fixes in the page.',
      inputSchema: {
        type: 'object',
        properties: { charge_id: { type: 'string', description: 'Refundable charge ID returned by check_charge_validity.' } },
        required: ['charge_id'], additionalProperties: false
      },
      annotations: writeAnnotations,
      execute: async (input) => stringify(await service.refundInvalidCharge(input))
    },
    {
      name: 'change_plan',
      title: 'Change plan',
      description: 'Change the customer’s plan. Fails unless the human explicitly approved this exact plan ID in the page; bill-fix approval alone is insufficient.',
      inputSchema: {
        type: 'object',
        properties: { plan_id: { type: 'string', description: 'Exact plan ID returned by list_plan_options.' } },
        required: ['plan_id'], additionalProperties: false
      },
      annotations: writeAnnotations,
      execute: async (input) => stringify(await service.changePlan(input))
    },
    {
      name: 'get_resolution_receipt',
      title: 'Get resolution receipt',
      description: 'Read the final case receipt with original bill, applied credit, refund, new balance, plan-change status, and resolution time.',
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
      execute: async () => stringify(await service.getResolutionReceipt())
    }
  ];
}

export async function registerAdvocateTools(service) {
  if (!document.modelContext?.registerTool) return { supported: false, count: 0 };
  const tools = createToolDefinitions(service);
  for (const tool of tools) {
    // The WebMCP Challenge requires real browser-native imperative registration.
    await document.modelContext.registerTool(tool);
  }
  return { supported: true, count: tools.length };
}
