import './style.css';
import {
  STORAGE_KEY,
  appendActivity,
  buildDecisionBrief,
  calculateReadiness,
  clone,
  createId,
  defaultWorkspace,
  findEvidenceGaps,
  generateCounterarguments,
  normalizeWorkspace,
  searchWorkspace,
  summarizeWorkspace
} from './domain.js';
import { registerWebMCP } from './webmcp.js';

const app = document.querySelector('#app');
let workspace = loadWorkspace();
let webmcpStatus = { supported: Boolean(document.modelContext?.registerTool), count: 0, message: 'Detecting WebMCP…' };

function loadWorkspace() {
  try {
    return normalizeWorkspace(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return clone(defaultWorkspace);
  }
}

function saveWorkspace(next = workspace) {
  workspace = normalizeWorkspace(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function render() {
  const stats = summarizeWorkspace(workspace);
  const readiness = calculateReadiness(workspace);
  const gaps = findEvidenceGaps(workspace);
  const forClaims = workspace.claims.filter((c) => c.side === 'for');
  const againstClaims = workspace.claims.filter((c) => c.side === 'against');

  app.innerHTML = `
    <header class="topbar">
      <div>
        <div class="eyebrow">WEBMCP CHALLENGE · AGENT-NATIVE DECISIONS</div>
        <h1>Advocate</h1>
        <p class="lede">A shared reasoning surface where people set judgment and agents do structured evidence work.</p>
      </div>
      <div class="webmcp-pill ${webmcpStatus.supported ? 'ok' : 'muted'}">
        <span class="dot"></span>
        ${webmcpStatus.supported ? `${webmcpStatus.count || 10} WebMCP tools ready` : 'WebMCP browser not detected'}
      </div>
    </header>

    <main>
      <section class="hero-panel panel">
        <div class="hero-copy">
          <span class="label">ACTIVE DECISION</span>
          <h2>${esc(workspace.title)}</h2>
          <p>${esc(workspace.context)}</p>
          <div class="meta-row"><span>Owner: ${esc(workspace.decisionOwner)}</span><span>Status: ${esc(readiness.band)}</span></div>
        </div>
        <div class="readiness-card">
          <div class="score">${readiness.score}</div>
          <div><strong>Decision readiness</strong><br><span>${readiness.reasons[0] || 'Structured enough for human judgment.'}</span></div>
        </div>
      </section>

      <section class="metrics">
        ${metric('Claims', workspace.claims.length, `${stats.balance.for} for · ${stats.balance.against} against`)}
        ${metric('Evidence coverage', `${stats.evidenceCoverage}%`, `${stats.linkedEvidence} sources linked`)}
        ${metric('Open questions', stats.openQuestions, stats.openQuestions ? 'Need explicit resolution' : 'No blockers recorded')}
        ${metric('Next actions', stats.pendingActions, 'Owned follow-ups')}
      </section>

      <section class="workspace-grid">
        <div class="panel span-2">
          <div class="section-head"><div><span class="label">ARGUMENT MAP</span><h3>Make the disagreement legible</h3></div><button data-action="add-claim">+ claim</button></div>
          <div class="argument-columns">
            <div><h4 class="for-title">Case for</h4>${claimsHtml(forClaims)}</div>
            <div><h4 class="against-title">Case against</h4>${claimsHtml(againstClaims)}</div>
          </div>
        </div>

        <aside class="panel">
          <div class="section-head"><div><span class="label">AGENT AUDIT</span><h3>What needs attention</h3></div></div>
          <div class="audit-list">
            ${gaps.slice(0,4).map((gap) => `<div class="audit-item"><strong>${esc(gap.side)} claim</strong><p>${esc(gap.recommendation)}</p></div>`).join('') || '<div class="empty">No obvious evidence gaps.</div>'}
          </div>
          <button class="secondary full" data-action="counterarguments">Stress-test the case</button>
        </aside>

        <div class="panel">
          <div class="section-head"><div><span class="label">EVIDENCE</span><h3>Sources, not vibes</h3></div><button data-action="add-evidence">+ evidence</button></div>
          <div class="stack">${workspace.evidence.map(evidenceHtml).join('')}</div>
        </div>

        <div class="panel">
          <div class="section-head"><div><span class="label">DECISION CRITERIA</span><h3>What matters most</h3></div></div>
          <div class="stack">${workspace.criteria.sort((a,b)=>b.weight-a.weight).map((c) => `<div class="criterion"><span>${esc(c.label)}</span><strong>${'●'.repeat(c.weight)}${'○'.repeat(5-c.weight)}</strong></div>`).join('')}</div>
        </div>

        <div class="panel">
          <div class="section-head"><div><span class="label">OPEN QUESTIONS</span><h3>Unknowns before commitment</h3></div><button data-action="add-question">+ question</button></div>
          <div class="stack">${workspace.questions.map(questionHtml).join('')}</div>
        </div>

        <div class="panel span-2">
          <div class="section-head"><div><span class="label">DECISION BRIEF</span><h3>Auditable synthesis</h3></div><button data-action="copy-brief">Copy brief</button></div>
          ${briefHtml(buildDecisionBrief(workspace))}
        </div>

        <div class="panel">
          <div class="section-head"><div><span class="label">NEXT ACTIONS</span><h3>Turn uncertainty into work</h3></div><button data-action="add-action">+ action</button></div>
          <div class="stack">${workspace.actions.map(actionHtml).join('')}</div>
        </div>

        <div class="panel span-3">
          <div class="section-head"><div><span class="label">HUMAN + AGENT</span><h3>Try it with a WebMCP-aware agent</h3></div></div>
          <div class="prompt-grid">
            ${[
              'Inspect this decision workspace and tell me what evidence is missing.',
              'Stress-test the case for this decision, then add only well-grounded counterclaims.',
              'Assess decision readiness and create concrete actions for the biggest gaps.',
              'Generate a decision brief that preserves unresolved uncertainty.'
            ].map((p) => `<button class="prompt" data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}
          </div>
          <p class="fineprint">WebMCP tools mutate the same browser state as the visible UI. Agent activity is logged locally; the final decision remains human.</p>
        </div>
      </section>
    </main>

    <footer><span>Advocate stores workspace data locally in your browser.</span><button class="link-button" data-action="reset">Reset sample workspace</button></footer>
    <dialog id="modal"></dialog>
    <div id="toast" role="status" aria-live="polite"></div>
  `;
  wireEvents();
}

function metric(label, value, note) {
  return `<div class="metric panel"><span class="label">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
}
function claimsHtml(items) {
  return items.map((c) => `<article class="claim"><div class="confidence">${Number(c.confidence)||0}%</div><p>${esc(c.text)}</p><small>${(c.evidenceIds || []).length} linked evidence</small></article>`).join('') || '<div class="empty">No claims yet.</div>';
}
function evidenceHtml(e) {
  const url = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noreferrer">source ↗</a>` : '';
  return `<article class="evidence"><div><strong>${esc(e.title)}</strong><small>${esc(e.source)} · reliability ${e.reliability}/5</small></div><p>${esc(e.summary)}</p>${url}</article>`;
}
function questionHtml(q) {
  return `<label class="check-row"><input type="checkbox" data-resolve="${esc(q.id)}" ${q.resolved ? 'checked' : ''}><span><strong>${esc(q.text)}</strong>${q.resolution ? `<small>${esc(q.resolution)}</small>` : ''}</span></label>`;
}
function actionHtml(a) {
  return `<label class="check-row"><input type="checkbox" data-action-done="${esc(a.id)}" ${a.done ? 'checked' : ''}><span><strong>${esc(a.text)}</strong><small>${esc(a.owner)}</small></span></label>`;
}
function briefHtml(brief) {
  const forText = brief.strongestCaseFor[0]?.text || 'No supporting case recorded.';
  const againstText = brief.strongestCaseAgainst[0]?.text || 'No opposing case recorded.';
  return `<div class="brief"><div><span class="label">STRONGEST FOR</span><p>${esc(forText)}</p></div><div><span class="label">STRONGEST AGAINST</span><p>${esc(againstText)}</p></div><div><span class="label">RECOMMENDATION</span><p>${esc(brief.recommendation)}</p></div></div>`;
}

function wireEvents() {
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action)));
  document.querySelectorAll('[data-resolve]').forEach((input) => input.addEventListener('change', () => {
    const q = workspace.questions.find((x) => x.id === input.dataset.resolve);
    if (q) { q.resolved = input.checked; if (!input.checked) delete q.resolution; appendActivity(workspace, 'human', `${input.checked ? 'Resolved' : 'Reopened'} question: ${q.text}`); saveWorkspace(); render(); }
  }));
  document.querySelectorAll('[data-action-done]').forEach((input) => input.addEventListener('change', () => {
    const a = workspace.actions.find((x) => x.id === input.dataset.actionDone);
    if (a) { a.done = input.checked; appendActivity(workspace, 'human', `${input.checked ? 'Completed' : 'Reopened'} action: ${a.text}`); saveWorkspace(); render(); }
  }));
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(button.dataset.prompt);
    toast('Prompt copied — paste it into your WebMCP-aware agent.');
  }));
}

function handleAction(action) {
  if (action === 'add-claim') return showForm('Add claim', [
    ['side','select','Side','for|against|neutral'], ['text','textarea','Claim'], ['confidence','number','Confidence (0–100)','70']
  ], (data) => { workspace.claims.push({ id:createId('cl'), side:data.side, text:data.text, confidence:Math.max(0,Math.min(100,Number(data.confidence)||50)), evidenceIds:[] }); appendActivity(workspace,'human',`Added ${data.side} claim: ${data.text}`); saveWorkspace(); render(); });
  if (action === 'add-evidence') return showForm('Add evidence', [
    ['title','text','Title'], ['source','text','Source'], ['url','url','URL (optional)'], ['summary','textarea','Summary'], ['reliability','number','Reliability (1–5)','3']
  ], (data) => { workspace.evidence.push({ id:createId('e'), title:data.title, source:data.source, url:data.url||'', summary:data.summary, reliability:Math.max(1,Math.min(5,Number(data.reliability)||3)) }); appendActivity(workspace,'human',`Added evidence: ${data.title}`); saveWorkspace(); render(); });
  if (action === 'add-question') return showForm('Add open question', [['text','textarea','Question']], (data) => { workspace.questions.push({id:createId('q'),text:data.text,resolved:false}); appendActivity(workspace,'human',`Added question: ${data.text}`); saveWorkspace(); render(); });
  if (action === 'add-action') return showForm('Add next action', [['text','textarea','Action'],['owner','text','Owner']], (data) => { workspace.actions.push({id:createId('a'),text:data.text,owner:data.owner,done:false}); appendActivity(workspace,'human',`Created action: ${data.text}`); saveWorkspace(); render(); });
  if (action === 'counterarguments') return showText('Stress test', generateCounterarguments(workspace, 'for', 6).map((x)=>`• ${x.text}`).join('\n\n'));
  if (action === 'copy-brief') { navigator.clipboard?.writeText(JSON.stringify(buildDecisionBrief(workspace), null, 2)); return toast('Decision brief copied.'); }
  if (action === 'reset') { workspace = clone(defaultWorkspace); saveWorkspace(); render(); toast('Sample workspace restored.'); }
}

function showForm(title, fields, onSubmit) {
  const modal = document.querySelector('#modal');
  modal.innerHTML = `<form method="dialog" id="entry-form"><div class="dialog-head"><h3>${esc(title)}</h3><button value="cancel" class="icon">×</button></div>${fields.map(([name,type,label,extra]) => {
    if (type === 'textarea') return `<label>${esc(label)}<textarea name="${name}" required></textarea></label>`;
    if (type === 'select') return `<label>${esc(label)}<select name="${name}">${extra.split('|').map(v=>`<option>${esc(v)}</option>`).join('')}</select></label>`;
    return `<label>${esc(label)}<input type="${type}" name="${name}" ${extra ? `value="${esc(extra)}"` : ''} ${name==='url' ? '' : 'required'}></label>`;
  }).join('')}<div class="dialog-actions"><button value="cancel" class="secondary">Cancel</button><button value="default" id="submit-dialog">Save</button></div></form>`;
  modal.showModal();
  modal.querySelector('#entry-form').addEventListener('submit', (event) => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    onSubmit(data); modal.close();
  });
}
function showText(title, text) {
  const modal = document.querySelector('#modal');
  modal.innerHTML = `<div class="dialog-head"><h3>${esc(title)}</h3><button class="icon" id="close-modal">×</button></div><pre>${esc(text)}</pre>`;
  modal.showModal(); modal.querySelector('#close-modal').onclick = () => modal.close();
}
function toast(message) { const node=document.querySelector('#toast'); if(!node)return; node.textContent=message; node.classList.add('show'); setTimeout(()=>node.classList.remove('show'),2200); }

render();
registerWebMCP({
  getWorkspace: () => workspace,
  saveWorkspace: (next) => saveWorkspace(next),
  onChange: render,
  onStatus: (status) => { webmcpStatus = status; render(); }
}).catch((error) => {
  webmcpStatus = { supported: false, count: 0, message: error.message };
  console.error('WebMCP registration failed', error);
  render();
});

window.__ADVOCATE__ = { getWorkspace: () => clone(workspace), searchWorkspace: (q,l) => searchWorkspace(workspace,q,l), readiness: () => calculateReadiness(workspace) };
