const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false });
const WRITE_NON_IDEMPOTENT = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false });
const WRITE_DESTRUCTIVE_IDEMPOTENT = Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, untrustedContentHint: false });

const CONTRACT_CLAUSES = Object.freeze({
  payment_terms_7_4: Object.freeze({
    clause_id: 'payment_terms_7_4',
    heading: '§ 7.4 Settlement Timing',
    contract_version: 'MSA-2026.04',
    expected: 'Approved invoices settle within 15 calendar days of acceptance.',
    observed: 'Invoice INV-0427 remains unsettled 47 calendar days after acceptance.',
    settlement_window_days: 15,
    days_after_acceptance: 47,
    breach_delay_days: 32,
    breach_term: '15 calendar days',
    source: 'Master Services Agreement · signed 2026-04-02',
    evidence_ref: 'sha256:contract:7.4:INV-0427'
  })
});

const RULES = Object.freeze({
  CA: Object.freeze({ label: 'California', annualRate: 0.10, citation: 'Cal. Civ. Code § 3289(b)', rule: '10% annual post-breach interest when a contract does not stipulate a legal rate.' }),
  NY: Object.freeze({ label: 'New York', annualRate: 0.09, citation: 'N.Y. C.P.L.R. § 5004', rule: '9% annual statutory interest.' }),
  TX: Object.freeze({ label: 'Texas', annualRate: 0.085, citation: 'Tex. Fin. Code § 304.003', rule: 'Demo rate used for this simulated claim; verify the current published rate before production filing.' })
});

const SHA256_HEX_PATTERN = '^[a-f0-9]{64}$';
const ISO_INSTANT_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

const CLAIM_PAYLOAD_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    case_id: { type: 'string', minLength: 1, maxLength: 64 },
    claimant: { type: 'string', minLength: 1, maxLength: 160 },
    counterparty: { type: 'string', minLength: 1, maxLength: 160 },
    clause_id: { type: 'string', minLength: 1, maxLength: 96 },
    breach_clause: { type: 'string', minLength: 1, maxLength: 180 },
    jurisdiction: { type: 'string', enum: ['CA', 'NY', 'TX'] },
    delay_days: { type: 'integer', minimum: 0, maximum: 36500 },
    base_amount: { type: 'number', minimum: 0, maximum: 1000000000 },
    statutory_penalty: { type: 'number', minimum: 0, maximum: 1000000000 },
    claim_total: { type: 'number', minimum: 0, maximum: 2000000000 },
    statutory_citation: { type: 'string', minLength: 1, maxLength: 180 },
    authorization_proof: { type: 'string', minLength: 64, maxLength: 64, pattern: SHA256_HEX_PATTERN },
    approved_at: { type: 'string', minLength: 24, maxLength: 24, pattern: ISO_INSTANT_PATTERN }
  },
  required: [
    'case_id', 'claimant', 'counterparty', 'clause_id', 'breach_clause', 'jurisdiction', 'delay_days',
    'base_amount', 'statutory_penalty', 'claim_total', 'statutory_citation', 'authorization_proof', 'approved_at'
  ],
  additionalProperties: false
});

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function computePenalty(rule, delayDays, baseAmount) {
  return roundCurrency(baseAmount * rule.annualRate * delayDays / 365);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function typeMatches(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function validateSchemaValue(schema, value, path, errors) {
  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${path} must be ${schema.type}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`);

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has invalid format`);
  }

  if (schema.type === 'object' && typeMatches(value, 'object')) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) validateSchemaValue(childSchema, value[key], `${path}.${key}`, errors);
    }
  }
}

export function validateInput(schema, input) {
  const errors = [];
  validateSchemaValue(schema, input ?? {}, 'input', errors);
  return { valid: errors.length === 0, errors };
}

function telemetry(detail, sink) {
  sink?.(detail);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('advocate:webmcp-telemetry', { detail }));
  }
}

function inputSchema(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function assertClaimIntegrity(claimPayload) {
  const rule = RULES[claimPayload.jurisdiction];
  const clause = CONTRACT_CLAUSES[claimPayload.clause_id];
  if (!rule) throw new Error(`Unsupported jurisdiction: ${claimPayload.jurisdiction}`);
  if (!clause) throw new Error(`Unknown clause_id: ${claimPayload.clause_id}`);
  if (claimPayload.breach_clause !== clause.heading) throw new Error('breach_clause does not match the signed contract clause');
  if (claimPayload.statutory_citation !== rule.citation) throw new Error('statutory_citation does not match the selected jurisdiction rule');

  const expectedPenalty = computePenalty(rule, claimPayload.delay_days, claimPayload.base_amount);
  if (Math.abs(expectedPenalty - claimPayload.statutory_penalty) > 0.001) {
    throw new Error(`statutory_penalty does not match the verified calculation (${expectedPenalty.toFixed(2)})`);
  }
  const expectedTotal = roundCurrency(claimPayload.base_amount + expectedPenalty);
  if (Math.abs(expectedTotal - claimPayload.claim_total) > 0.001) {
    throw new Error(`claim_total does not match principal plus statutory component (${expectedTotal.toFixed(2)})`);
  }
}

export function createToolDefinitions(state = {}) {
  const runtimeState = state;
  runtimeState.notices ||= new Map();
  runtimeState.receipts ||= new Map();

  return [
    {
      name: 'fetch_contract_clause',
      title: 'Fetch contract clause',
      description: 'Fetch a signed contract clause by stable clause ID for an autonomous breach audit. Returns the expected term, observed condition, and evidence reference.',
      inputSchema: inputSchema({ clause_id: { type: 'string', minLength: 1, maxLength: 96, description: 'Stable clause identifier, for example payment_terms_7_4.' } }, ['clause_id']),
      annotations: READ_ONLY,
      execute: async ({ clause_id }) => {
        const clause = CONTRACT_CLAUSES[clause_id];
        if (!clause) throw new Error(`Unknown clause_id: ${clause_id}`);
        return { ok: true, clause };
      }
    },
    {
      name: 'compute_statutory_penalty',
      title: 'Compute statutory penalty',
      description: 'Compute the simulated statutory interest component for a delayed contractual payment using a jurisdiction-specific rule and return the citation used.',
      inputSchema: inputSchema({
        jurisdiction: { type: 'string', enum: ['CA', 'NY', 'TX'], description: 'Two-letter jurisdiction code supported by the demo rulebook.' },
        delay_days: { type: 'integer', minimum: 0, maximum: 36500, description: 'Calendar days after the contractual settlement deadline.' },
        base_amount: { type: 'number', minimum: 0, maximum: 1000000000, description: 'Unpaid contractual principal in USD.' }
      }, ['jurisdiction', 'delay_days', 'base_amount']),
      annotations: READ_ONLY,
      execute: async ({ jurisdiction, delay_days, base_amount }) => {
        const rule = RULES[jurisdiction];
        const penalty = computePenalty(rule, delay_days, base_amount);
        const claimTotal = roundCurrency(base_amount + penalty);
        return {
          ok: true,
          jurisdiction: rule.label,
          jurisdiction_code: jurisdiction,
          delay_days,
          base_amount,
          annual_rate: rule.annualRate,
          statutory_penalty: penalty,
          claim_total: claimTotal,
          statutory_citation: rule.citation,
          rule: rule.rule,
          simulation_notice: 'Demonstration calculation only; production legal use requires jurisdiction-specific verification.'
        };
      }
    },
    {
      name: 'generate_enforceable_demand_notice',
      title: 'Generate demand notice',
      description: 'Generate a structured demand notice from an already-calculated claim payload after human authorization. The result is hashed and staged for filing.',
      inputSchema: inputSchema({
        claim_payload: {
          ...CLAIM_PAYLOAD_SCHEMA,
          description: 'Verified claim payload containing claimant, counterparty, principal, statutory component, total, citation, breach clause, and authorization proof.'
        }
      }, ['claim_payload']),
      annotations: WRITE_NON_IDEMPOTENT,
      execute: async ({ claim_payload }) => {
        assertClaimIntegrity(claim_payload);
        const actionId = `ACT-${String(runtimeState.notices.size + 1).padStart(4, '0')}-${Date.now().toString(36).toUpperCase()}`;
        const issuedAt = new Date().toISOString();
        const claimHash = await sha256({ ...claim_payload, authorization_proof: undefined });
        const notice = Object.freeze({
          action_id: actionId,
          issued_at: issuedAt,
          claimant: claim_payload.claimant,
          counterparty: claim_payload.counterparty,
          demand_amount: claim_payload.claim_total,
          currency: 'USD',
          breach_clause: claim_payload.breach_clause,
          statutory_citation: claim_payload.statutory_citation,
          claim_hash: claimHash,
          authorization_proof: claim_payload.authorization_proof,
          demand: `Pay $${Number(claim_payload.claim_total).toFixed(2)} within 10 calendar days or dispute this claim through the recorded channel.`,
          status: 'AUTHORIZED_FOR_FILING'
        });
        runtimeState.notices.set(actionId, notice);
        return { ok: true, notice };
      }
    },
    {
      name: 'file_dispute_record',
      title: 'File dispute record',
      description: 'Commit an authorized demand action to the in-browser immutable demo ledger using the action ID and cryptographic human-approval proof hash.',
      inputSchema: inputSchema({
        action_id: { type: 'string', minLength: 1, maxLength: 128, description: 'Action ID returned by generate_enforceable_demand_notice.' },
        proof_hash: { type: 'string', minLength: 64, maxLength: 64, pattern: SHA256_HEX_PATTERN, description: 'SHA-256 proof of the one-click human authorization payload.' }
      }, ['action_id', 'proof_hash']),
      annotations: WRITE_DESTRUCTIVE_IDEMPOTENT,
      execute: async ({ action_id, proof_hash }) => {
        const notice = runtimeState.notices.get(action_id);
        if (!notice) throw new Error(`Unknown action_id: ${action_id}`);
        if (notice.authorization_proof !== proof_hash) throw new Error('proof_hash does not match the authorized notice');
        if (runtimeState.receipts.has(action_id)) return { ok: true, replayed: true, receipt: runtimeState.receipts.get(action_id) };

        const filedAt = new Date().toISOString();
        const receiptBody = {
          action_id,
          filed_at: filedAt,
          status: 'RECORDED',
          claim_hash: notice.claim_hash,
          proof_hash,
          statutory_citation: notice.statutory_citation,
          ledger_sequence: runtimeState.receipts.size + 1
        };
        const receipt = Object.freeze({ ...receiptBody, receipt_hash: await sha256(receiptBody) });
        runtimeState.receipts.set(action_id, receipt);
        return { ok: true, replayed: false, receipt };
      }
    }
  ];
}

export function createWebMcpRuntime({ telemetrySink } = {}) {
  const state = { notices: new Map(), receipts: new Map() };
  const tools = createToolDefinitions(state);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  async function invoke(name, input = {}, source = 'in-browser-agent') {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
    const validation = validateInput(tool.inputSchema, input);
    telemetry({ kind: 'schema', tool: name, input, valid: validation.valid, errors: validation.errors, source, at: new Date().toISOString() }, telemetrySink);
    if (!validation.valid) throw new TypeError(`Schema validation failed: ${validation.errors.join('; ')}`);
    const started = nowMs();
    telemetry({ kind: 'call', tool: name, input, source, at: new Date().toISOString() }, telemetrySink);
    try {
      const output = await tool.execute(input);
      const latency_ms = Math.max(1, Math.round((nowMs() - started) * 10) / 10);
      telemetry({ kind: 'result', tool: name, input, output, latency_ms, source, at: new Date().toISOString() }, telemetrySink);
      return output;
    } catch (error) {
      const latency_ms = Math.max(1, Math.round((nowMs() - started) * 10) / 10);
      telemetry({ kind: 'error', tool: name, input, error: error instanceof Error ? error.message : String(error), latency_ms, source, at: new Date().toISOString() }, telemetrySink);
      throw error;
    }
  }

  return {
    version: 'advocate-webmcp/2.1',
    tools,
    listTools: () => tools.map(({ execute, ...descriptor }) => descriptor),
    invoke,
    get receiptCount() { return state.receipts.size; },
    get receipts() { return [...state.receipts.values()]; }
  };
}

export async function installAdvocateWebMcp(options = {}) {
  const runtime = createWebMcpRuntime(options);
  if (typeof window !== 'undefined') window.__webmcp = runtime;

  const modelContext =
    (typeof document !== 'undefined' && document.modelContext) ||
    (typeof navigator !== 'undefined' && navigator.modelContext) ||
    null;

  if (!modelContext?.registerTool) return { runtime, native: false, registered: 0, controller: null };

  const controller = new AbortController();
  let registered = 0;
  for (const tool of runtime.tools) {
    const nativeTool = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      execute: (input) => runtime.invoke(tool.name, input, 'native-webmcp-agent')
    };
    try {
      await modelContext.registerTool(nativeTool, { signal: controller.signal });
      registered += 1;
    } catch (error) {
      controller.abort();
      telemetry({ kind: 'registration-error', tool: tool.name, error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }, options.telemetrySink);
      return { runtime, native: false, registered: 0, controller: null };
    }
  }
  return { runtime, native: true, registered, controller };
}
