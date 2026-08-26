export const STORAGE_KEY = 'advocate-workspace-v1';

export const defaultWorkspace = {
  title: 'Should our team adopt a four-day workweek pilot?',
  context: 'A 20-person product team is evaluating a 90-day pilot. The goal is to improve focus and retention without reducing customer support quality.',
  decisionOwner: 'Product & Operations',
  status: 'exploring',
  criteria: [
    { id: 'c1', label: 'Customer impact', weight: 5 },
    { id: 'c2', label: 'Team wellbeing', weight: 4 },
    { id: 'c3', label: 'Delivery reliability', weight: 5 },
    { id: 'c4', label: 'Reversibility', weight: 3 }
  ],
  claims: [
    { id: 'cl1', side: 'for', text: 'A time-boxed pilot can test retention and focus benefits while keeping the decision reversible.', confidence: 82, evidenceIds: ['e1'] },
    { id: 'cl2', side: 'against', text: 'Compressed availability could create coverage gaps for customer support and incident response.', confidence: 76, evidenceIds: ['e2'] },
    { id: 'cl3', side: 'for', text: 'Success can be measured with pre-defined delivery, quality, support, and wellbeing metrics.', confidence: 88, evidenceIds: ['e3'] }
  ],
  evidence: [
    { id: 'e1', title: 'Pilot design constraint', source: 'Internal planning note', url: '', reliability: 4, summary: 'A 90-day pilot with opt-out criteria limits downside and preserves reversibility.' },
    { id: 'e2', title: 'Coverage risk', source: 'Support operating model', url: '', reliability: 4, summary: 'Customer coverage currently depends on weekday overlap and a rotating incident owner.' },
    { id: 'e3', title: 'Evaluation rubric', source: 'Advocate workspace', url: '', reliability: 5, summary: 'Baseline and pilot metrics can be compared across delivery, defects, support response, engagement, and attrition signals.' }
  ],
  questions: [
    { id: 'q1', text: 'What support hours are non-negotiable during the pilot?', resolved: false },
    { id: 'q2', text: 'What metric threshold would trigger an early rollback?', resolved: false }
  ],
  actions: [
    { id: 'a1', text: 'Define customer-support coverage guardrails', owner: 'Operations', done: false },
    { id: 'a2', text: 'Capture four weeks of baseline metrics', owner: 'Product', done: false }
  ],
  activity: [
    { id: 'log1', at: new Date().toISOString(), actor: 'system', message: 'Workspace initialized with a sample decision.' }
  ]
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeWorkspace(input) {
  const base = clone(defaultWorkspace);
  const source = input && typeof input === 'object' ? input : {};
  return {
    ...base,
    ...source,
    criteria: Array.isArray(source.criteria) ? source.criteria : base.criteria,
    claims: Array.isArray(source.claims) ? source.claims : base.claims,
    evidence: Array.isArray(source.evidence) ? source.evidence : base.evidence,
    questions: Array.isArray(source.questions) ? source.questions : base.questions,
    actions: Array.isArray(source.actions) ? source.actions : base.actions,
    activity: Array.isArray(source.activity) ? source.activity : base.activity
  };
}

export function workspaceSnapshot(workspace) {
  const w = normalizeWorkspace(workspace);
  return {
    title: w.title,
    context: w.context,
    decisionOwner: w.decisionOwner,
    status: w.status,
    criteria: w.criteria,
    claims: w.claims,
    evidence: w.evidence,
    questions: w.questions,
    actions: w.actions,
    stats: summarizeWorkspace(w)
  };
}

export function summarizeWorkspace(workspace) {
  const w = normalizeWorkspace(workspace);
  const openQuestions = w.questions.filter((q) => !q.resolved).length;
  const pendingActions = w.actions.filter((a) => !a.done).length;
  const linkedEvidence = new Set(w.claims.flatMap((c) => c.evidenceIds || [])).size;
  const avgConfidence = w.claims.length
    ? Math.round(w.claims.reduce((sum, c) => sum + Number(c.confidence || 0), 0) / w.claims.length)
    : 0;
  const evidenceCoverage = w.claims.length
    ? Math.round((w.claims.filter((c) => (c.evidenceIds || []).length > 0).length / w.claims.length) * 100)
    : 0;
  const balance = {
    for: w.claims.filter((c) => c.side === 'for').length,
    against: w.claims.filter((c) => c.side === 'against').length,
    neutral: w.claims.filter((c) => c.side === 'neutral').length
  };
  return { openQuestions, pendingActions, linkedEvidence, avgConfidence, evidenceCoverage, balance };
}

export function searchWorkspace(workspace, query, limit = 10) {
  const w = normalizeWorkspace(workspace);
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const rows = [
    ...w.claims.map((item) => ({ type: 'claim', id: item.id, label: item.text, meta: item.side })),
    ...w.evidence.map((item) => ({ type: 'evidence', id: item.id, label: `${item.title}: ${item.summary}`, meta: item.source })),
    ...w.questions.map((item) => ({ type: 'question', id: item.id, label: item.text, meta: item.resolved ? 'resolved' : 'open' })),
    ...w.actions.map((item) => ({ type: 'action', id: item.id, label: item.text, meta: item.owner })),
    ...w.criteria.map((item) => ({ type: 'criterion', id: item.id, label: item.label, meta: `weight ${item.weight}` }))
  ];
  return rows
    .map((row) => ({
      ...row,
      score: terms.reduce((score, term) => score + (row.label.toLowerCase().includes(term) ? 2 : 0) + (String(row.meta).toLowerCase().includes(term) ? 1 : 0), 0)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 25)));
}

export function findEvidenceGaps(workspace) {
  const w = normalizeWorkspace(workspace);
  return w.claims
    .filter((claim) => !claim.evidenceIds?.length || Number(claim.confidence || 0) >= 70 && claim.evidenceIds.length < 2)
    .map((claim) => ({
      claimId: claim.id,
      claim: claim.text,
      side: claim.side,
      confidence: claim.confidence,
      evidenceCount: claim.evidenceIds?.length || 0,
      recommendation: !claim.evidenceIds?.length
        ? 'Attach at least one concrete source before relying on this claim.'
        : 'High-confidence claim has only one source; add corroborating or contradictory evidence.'
    }));
}

export function generateCounterarguments(workspace, side = 'for', limit = 4) {
  const w = normalizeWorkspace(workspace);
  const opposing = side === 'for' ? 'against' : 'for';
  const existing = w.claims.filter((c) => c.side === opposing).map((c) => c.text);
  const openQuestions = w.questions.filter((q) => !q.resolved).map((q) => q.text);
  const criteria = [...w.criteria].sort((a, b) => b.weight - a.weight).map((c) => c.label);
  const prompts = [];
  existing.forEach((text) => prompts.push({ source: 'existing-opposition', text }));
  openQuestions.forEach((text) => prompts.push({ source: 'unresolved-question', text: `Challenge the ${side} case by resolving: ${text}` }));
  criteria.forEach((label) => prompts.push({ source: 'criterion', text: `What is the strongest ${opposing} argument when judged specifically on ${label}?` }));
  return prompts.slice(0, Math.max(1, Math.min(Number(limit) || 4, 8)));
}

export function calculateReadiness(workspace) {
  const w = normalizeWorkspace(workspace);
  const stats = summarizeWorkspace(w);
  let score = 0;
  const reasons = [];
  if (w.claims.length >= 4) score += 20; else reasons.push('Add more substantive claims.');
  if (stats.balance.for > 0 && stats.balance.against > 0) score += 20; else reasons.push('Represent both supporting and opposing arguments.');
  if (stats.evidenceCoverage >= 80) score += 20; else reasons.push('Link evidence to at least 80% of claims.');
  if (stats.openQuestions <= 1) score += 15; else reasons.push('Resolve or explicitly defer open questions.');
  if (w.criteria.length >= 3) score += 10; else reasons.push('Define at least three decision criteria.');
  if (stats.pendingActions <= 2) score += 15; else reasons.push('Reduce the number of unowned or incomplete next actions.');
  return { score, band: score >= 85 ? 'decision-ready' : score >= 65 ? 'nearly-ready' : 'exploring', reasons, stats };
}

export function buildDecisionBrief(workspace) {
  const w = normalizeWorkspace(workspace);
  const readiness = calculateReadiness(w);
  const topFor = w.claims.filter((c) => c.side === 'for').sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const topAgainst = w.claims.filter((c) => c.side === 'against').sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const unresolved = w.questions.filter((q) => !q.resolved).slice(0, 5);
  const actions = w.actions.filter((a) => !a.done).slice(0, 5);
  const weightedCriteria = [...w.criteria].sort((a, b) => b.weight - a.weight).slice(0, 4);
  return {
    decision: w.title,
    owner: w.decisionOwner,
    context: w.context,
    readiness,
    strongestCaseFor: topFor,
    strongestCaseAgainst: topAgainst,
    priorityCriteria: weightedCriteria,
    unresolvedQuestions: unresolved,
    nextActions: actions,
    recommendation: readiness.score >= 85
      ? 'The workspace is sufficiently structured to make or document a decision, subject to human judgment.'
      : 'Do not treat this as decision-ready yet; address the listed readiness gaps first.'
  };
}

export function appendActivity(workspace, actor, message) {
  workspace.activity.unshift({ id: createId('log'), at: new Date().toISOString(), actor, message });
  workspace.activity = workspace.activity.slice(0, 50);
  return workspace;
}
