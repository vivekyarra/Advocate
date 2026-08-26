const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const WRITE = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

const CONTRACT_CLAUSES = Object.freeze({
  payment_terms_7_4: Object.freeze({
    clause_id: 'payment_terms_7_4',
    heading: '§ 7.4 Settlement Timing',
    contract_version: 'MSA-2026.04',
    expected: 'Approved invoices settle within 15 calendar days of acceptance.',
    observed: 'Invoice INV-0427 remains unsettled 47 calendar days after acceptance.',
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

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
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

export function validateInput(schema, input) {
  const errors = [];
  const value = input ?? {};
  if (schema.type && !typeMatches(value, schema.type)) return { valid: false, errors: [`input must be ${schema.type}`] };
  const properties = schema.properties || {};
  for (const key of schema.required || []) {
    if (!(key in value)) errors.push(`${key} is required`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!(key in properties)) errors.push(`${key} is not allowed`);
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (!(key in value)) continue;
    const child = value[key];
    if (childSchema.type && !typeMatches(child, childSchema.type)) errors.push(`${key} must be ${childSchema.type}`);
    if (childSchema.enum && !childSchema.enum.includes(child)) errors.push(`${key} must be one of ${childSchema.enum.join(', ')}`);
    if (typeof child === 'number' && typeof childSchema.minimum === 'number' && child < childSchema.minimum) errors.push(`${key} must be >= ${childSchema.minimum}`);
    if (typeof child === 'string' && typeof childSchema.minLength === 'number' && child.length < childSchema.minLength) errors.push(`${key} is too short`);
  }
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

export function createToolDefinitions(state = {}) {
  const runtimeState = state;
  runtimeState.notices ||= new Map();
  runtimeState.receipts ||= new Map();

  return [
    {
      name: 'fetch_contract_clause',
      title: 'Fetch contract clause',
      description: 'Fetch a signed contract clause by stable clause ID for an autonomous breach audit. Returns the expected term, observed condition, and evidence reference.',
      inputSchema: inputSchema({ clause_id: { type: 'string', minLength: 1, description: 'Stable clause identifier, for example payment_terms_7_4.' } }, ['clause_id']),
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
        delay_days: { type: 'integer', minimum: 0, description: 'Calendar days after the contractual settlement deadline.' },
        base_amount: { type: 'number', minimum: 0, description: 'Unpaid contractual principal in USD.' }
      }, ['jurisdiction', 'delay_days', 'base_amount']),
      annotations: READ_ONLY,
      execute: async ({ jurisdiction, delay_days, base_amount }) => {
        const rule = RULES[jurisdiction];
        const penalty = Math.round((base_amount * rule.annualRate * delay_days / 365) * 100) / 100;
        const claimTotal = Math.round((base_amount + penalty) * 100) / 100;
        return {
          ok: true,
          jurisdiction: rule.label,
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
          type: 'object',
          description: 'Verified claim payload containing claimant, counterparty, principal, penalty, total, citation, breach clause, and authorization proof.'
        }
      }, ['claim_payload']),
      annotations: WRITE,
      execute: async ({ claim_payload }) => {
        if (!claim_payload.authorization_proof) throw new Error('authorization_proof is required before notice generation');
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
        action_id: { type: 'string', minLength: 1, description: 'Action ID returned by generate_enforceable_demand_notice.' },
        proof_hash: { type: 'string', minLength: 32, description: 'SHA-256 proof of the one-click human authorization payload.' }
      }, ['action_id', 'proof_hash']),
      annotations: WRITE,
      execute: async ({ action_id, proof_hash }) => {
        if (runtimeState.receipts.has(action_id)) return { ok: true, replayed: true, receipt: runtimeState.receipts.get(action_id) };
        const notice = runtimeState.notices.get(action_id);
        if (!notice) throw new Error(`Unknown action_id: ${action_id}`);
        if (notice.authorization_proof !== proof_hash) throw new Error('proof_hash does not match the authorized notice');
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
    version: 'advocate-webmcp/2.0',
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
      telemetry({ kind: 'registration-error', tool: tool.name, error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }, options.telemetrySink);
    }
  }
  return { runtime, native: registered === runtime.tools.length, registered, controller };
}
