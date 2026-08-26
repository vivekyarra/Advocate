import {
  appendActivity,
  buildDecisionBrief,
  calculateReadiness,
  createId,
  findEvidenceGaps,
  generateCounterarguments,
  searchWorkspace,
  workspaceSnapshot
} from './domain.js';

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export async function registerWebMCP({ getWorkspace, saveWorkspace, onChange, onStatus }) {
  const modelContext = document.modelContext;
  if (!modelContext?.registerTool) {
    onStatus?.({ supported: false, count: 0, message: 'WebMCP is not available in this browser. The app still works normally.' });
    return { dispose() {} };
  }

  const controllers = [];
  const register = async (tool) => {
    const controller = new AbortController();
    controllers.push(controller);
    await modelContext.registerTool(tool, { signal: controller.signal });
  };

  const commit = (workspace, message) => {
    appendActivity(workspace, 'agent', message);
    saveWorkspace(workspace);
    onChange?.();
  };

  await register({
    name: 'get_decision_workspace',
    title: 'Inspect decision workspace',
    description: 'Read the complete current Advocate decision workspace including claims, evidence, criteria, questions, actions, and summary statistics. Use this before recommending changes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => textResult(workspaceSnapshot(getWorkspace()))
  });

  await register({
    name: 'search_workspace',
    title: 'Search decision workspace',
    description: 'Search claims, evidence, open questions, actions, and criteria in the active decision workspace. Prefer this over guessing what is already recorded.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words or concepts to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum number of matches.' }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, limit = 10 }) => textResult({ query, results: searchWorkspace(getWorkspace(), query, limit) })
  });

  await register({
    name: 'add_claim',
    title: 'Add argument claim',
    description: 'Add a concise supporting, opposing, or neutral claim to the current decision. Use only when the claim is grounded in the user conversation or already available workspace evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['for', 'against', 'neutral'] },
        text: { type: 'string', minLength: 8, maxLength: 500 },
        confidence: { type: 'integer', minimum: 0, maximum: 100 },
        evidenceIds: { type: 'array', items: { type: 'string' }, maxItems: 10 }
      },
      required: ['side', 'text'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async ({ side, text, confidence = 50, evidenceIds = [] }) => {
      const w = getWorkspace();
      const validEvidence = new Set(w.evidence.map((e) => e.id));
      const claim = { id: createId('cl'), side, text: text.trim(), confidence, evidenceIds: evidenceIds.filter((id) => validEvidence.has(id)) };
      w.claims.push(claim);
      commit(w, `Added ${side} claim: ${claim.text}`);
      return textResult({ success: true, claim, readiness: calculateReadiness(w) });
    }
  });

  await register({
    name: 'add_evidence',
    title: 'Add evidence',
    description: 'Record evidence in the decision workspace. Include the real source and URL when available; never invent a citation or source.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 160 },
        source: { type: 'string', minLength: 2, maxLength: 160 },
        url: { type: 'string', maxLength: 1000 },
        summary: { type: 'string', minLength: 8, maxLength: 800 },
        reliability: { type: 'integer', minimum: 1, maximum: 5 },
        linkToClaimIds: { type: 'array', items: { type: 'string' }, maxItems: 20 }
      },
      required: ['title', 'source', 'summary'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async ({ title, source, url = '', summary, reliability = 3, linkToClaimIds = [] }) => {
      const w = getWorkspace();
      const evidence = { id: createId('e'), title: title.trim(), source: source.trim(), url: url.trim(), summary: summary.trim(), reliability };
      w.evidence.push(evidence);
      const validClaims = new Set(w.claims.map((c) => c.id));
      linkToClaimIds.filter((id) => validClaims.has(id)).forEach((id) => {
        const claim = w.claims.find((c) => c.id === id);
        claim.evidenceIds = Array.from(new Set([...(claim.evidenceIds || []), evidence.id]));
      });
      commit(w, `Added evidence: ${evidence.title}`);
      return textResult({ success: true, evidence });
    }
  });

  await register({
    name: 'surface_counterarguments',
    title: 'Surface counterarguments',
    description: 'Identify the strongest existing or missing counterarguments against one side of the decision using the current workspace. This is read-only and does not fabricate evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['for', 'against'], description: 'The side whose case should be stress-tested.' },
        limit: { type: 'integer', minimum: 1, maximum: 8 }
      },
      required: ['side'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async ({ side, limit = 4 }) => textResult({ sideBeingChallenged: side, counterarguments: generateCounterarguments(getWorkspace(), side, limit) })
  });

  await register({
    name: 'find_evidence_gaps',
    title: 'Find evidence gaps',
    description: 'Audit claims for missing or thin evidence, especially high-confidence claims that need corroboration. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => textResult({ gaps: findEvidenceGaps(getWorkspace()) })
  });

  await register({
    name: 'add_open_question',
    title: 'Add unresolved question',
    description: 'Add a concrete unresolved question that should be answered before the human makes the decision.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 8, maxLength: 400 } },
      required: ['text'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ text }) => {
      const w = getWorkspace();
      const question = { id: createId('q'), text: text.trim(), resolved: false };
      w.questions.push(question);
      commit(w, `Added open question: ${question.text}`);
      return textResult({ success: true, question });
    }
  });

  await register({
    name: 'resolve_question',
    title: 'Resolve question',
    description: 'Mark an existing open question resolved after the user or evidence has actually answered it.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string' },
        resolution: { type: 'string', minLength: 2, maxLength: 800 }
      },
      required: ['questionId', 'resolution'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async ({ questionId, resolution }) => {
      const w = getWorkspace();
      const question = w.questions.find((q) => q.id === questionId);
      if (!question) return textResult({ success: false, error: 'Question not found.' });
      question.resolved = true;
      question.resolution = resolution.trim();
      commit(w, `Resolved question: ${question.text}`);
      return textResult({ success: true, question, readiness: calculateReadiness(w) });
    }
  });

  await register({
    name: 'create_action',
    title: 'Create next action',
    description: 'Create a concrete follow-up action for the decision owner. Do not claim the action has been performed.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 5, maxLength: 400 },
        owner: { type: 'string', minLength: 1, maxLength: 120 }
      },
      required: ['text', 'owner'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ text, owner }) => {
      const w = getWorkspace();
      const action = { id: createId('a'), text: text.trim(), owner: owner.trim(), done: false };
      w.actions.push(action);
      commit(w, `Created action for ${action.owner}: ${action.text}`);
      return textResult({ success: true, action });
    }
  });

  await register({
    name: 'assess_decision_readiness',
    title: 'Assess decision readiness',
    description: 'Score how ready the current workspace is for a human decision using argument balance, evidence coverage, criteria, unresolved questions, and next actions. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => textResult(calculateReadiness(getWorkspace()))
  });

  await register({
    name: 'generate_decision_brief',
    title: 'Generate decision brief',
    description: 'Generate a structured, auditable decision brief from the current workspace. It summarizes; it does not make the final decision for the human.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => textResult(buildDecisionBrief(getWorkspace()))
  });

  onStatus?.({ supported: true, count: controllers.length, message: `${controllers.length} WebMCP tools registered.` });
  return { dispose: () => controllers.forEach((controller) => controller.abort()) };
}
