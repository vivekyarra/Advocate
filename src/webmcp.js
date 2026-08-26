const emptySchema = { type: 'object', properties: {}, additionalProperties: false };

function stringify(result) {
  return JSON.stringify(result);
}

export function createToolDefinitions(service) {
  return [
    {
      name: 'get_current_bill',
      title: 'Get current bill',
      description: 'Read the customer’s current bill, amount due, due date, status, and active plan.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => stringify(await service.getCurrentBill())
    },
    {
      name: 'get_previous_bills',
      title: 'Get previous bills',
      description: 'Read previous billing statements so the agent can compare the current bill with recent history.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => stringify(await service.getPreviousBills())
    },
    {
      name: 'compare_bills',
      title: 'Compare bills',
      description: 'Compare the current and previous bill and return the exact line-item changes that explain the difference.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => stringify(await service.compareBills())
    },
    {
      name: 'get_outage_history',
      title: 'Get outage history',
      description: 'Read confirmed service outages for this account, including duration and event identifiers used for eligibility checks.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
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
      annotations: { readOnlyHint: true, untrustedContentHint: false },
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
      annotations: { readOnlyHint: true, untrustedContentHint: false },
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
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input) => stringify(await service.checkChargeValidity(input))
    },
    {
      name: 'list_plan_options',
      title: 'List plan options',
      description: 'List the current plan and available alternatives, including equivalent-speed options and monthly savings. Does not change the plan.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => stringify(await service.listPlanOptions())
    },
    {
      name: 'get_resolution_summary',
      title: 'Get resolution summary',
      description: 'Summarize verified fixes, recovery amount, projected balance, plan opportunity, and current human approval scope.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => stringify(await service.getResolutionSummary())
    },
    {
      name: 'get_approval_status',
      title: 'Get approval status',
      description: 'Read which billing fixes and plan change, if any, the customer has explicitly approved in the page.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => stringify(await service.getApprovalStatus())
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
      annotations: { readOnlyHint: false, untrustedContentHint: false },
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
      annotations: { readOnlyHint: false, untrustedContentHint: false },
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
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => stringify(await service.changePlan(input))
    },
    {
      name: 'get_resolution_receipt',
      title: 'Get resolution receipt',
      description: 'Read the final case receipt with original bill, applied credit, refund, new balance, plan-change status, and resolution time.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
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
