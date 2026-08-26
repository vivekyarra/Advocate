import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecisionBrief,
  calculateReadiness,
  clone,
  defaultWorkspace,
  findEvidenceGaps,
  generateCounterarguments,
  normalizeWorkspace,
  searchWorkspace,
  summarizeWorkspace
} from '../src/domain.js';

test('normalizeWorkspace repairs malformed collection fields', () => {
  const normalized = normalizeWorkspace({ title: 'X', claims: null, evidence: 'bad' });
  assert.equal(normalized.title, 'X');
  assert.ok(Array.isArray(normalized.claims));
  assert.ok(Array.isArray(normalized.evidence));
});

test('summarizeWorkspace calculates balance and coverage', () => {
  const stats = summarizeWorkspace(defaultWorkspace);
  assert.equal(stats.balance.for, 2);
  assert.equal(stats.balance.against, 1);
  assert.equal(stats.evidenceCoverage, 100);
  assert.equal(stats.openQuestions, 2);
});

test('searchWorkspace ranks matching claims and evidence', () => {
  const results = searchWorkspace(defaultWorkspace, 'support coverage', 5);
  assert.ok(results.length > 0);
  assert.ok(results.some((r) => r.type === 'claim' || r.type === 'evidence'));
});

test('searchWorkspace handles empty and hostile-looking input safely', () => {
  assert.deepEqual(searchWorkspace(defaultWorkspace, '', 5), []);
  const results = searchWorkspace(defaultWorkspace, '<script>alert(1)</script> support', 1000);
  assert.ok(results.length <= 25);
});

test('findEvidenceGaps flags unsupported high-confidence claims', () => {
  const w = clone(defaultWorkspace);
  w.claims.push({ id: 'x', side: 'for', text: 'Unsupported assertion', confidence: 95, evidenceIds: [] });
  const gaps = findEvidenceGaps(w);
  assert.ok(gaps.some((g) => g.claimId === 'x'));
});

test('generateCounterarguments uses opposing claims, questions and criteria', () => {
  const prompts = generateCounterarguments(defaultWorkspace, 'for', 8);
  assert.ok(prompts.length >= 3);
  assert.ok(prompts.some((p) => p.source === 'existing-opposition'));
});

test('calculateReadiness rewards balanced well-evidenced workspaces', () => {
  const w = clone(defaultWorkspace);
  w.claims.push({ id: 'cl4', side: 'against', text: 'A second opposing claim', confidence: 70, evidenceIds: ['e1'] });
  w.questions.forEach((q) => { q.resolved = true; });
  w.actions.forEach((a) => { a.done = true; });
  const readiness = calculateReadiness(w);
  assert.ok(readiness.score >= 85);
  assert.equal(readiness.band, 'decision-ready');
});

test('calculateReadiness does not overstate sparse workspace quality', () => {
  const w = normalizeWorkspace({ title: 'Thin', claims: [], evidence: [], criteria: [], questions: [], actions: [] });
  const readiness = calculateReadiness(w);
  assert.ok(readiness.score < 65);
  assert.ok(readiness.reasons.length > 0);
});

test('buildDecisionBrief keeps final judgment with human', () => {
  const brief = buildDecisionBrief(defaultWorkspace);
  assert.match(brief.recommendation, /human|decision-ready|Do not/i);
  assert.equal(brief.decision, defaultWorkspace.title);
});

test('domain functions tolerate 5000 claims without throwing', () => {
  const w = clone(defaultWorkspace);
  w.claims = Array.from({ length: 5000 }, (_, i) => ({
    id: `c${i}`,
    side: i % 2 ? 'for' : 'against',
    text: `Claim number ${i} about reliability and impact`,
    confidence: i % 101,
    evidenceIds: i % 3 ? ['e1'] : []
  }));
  assert.doesNotThrow(() => summarizeWorkspace(w));
  assert.doesNotThrow(() => findEvidenceGaps(w));
  assert.doesNotThrow(() => searchWorkspace(w, 'reliability', 25));
  assert.doesNotThrow(() => buildDecisionBrief(w));
});
