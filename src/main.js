import { installAdvocateWebMcp, sha256 } from './webmcp.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
const compactHash = (hash) => hash ? `${hash.slice(0, 14)}…${hash.slice(-8)}` : '—';
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = {
  systemStatus: $('systemStatus'), protocolBadge: $('protocolBadge'), executeFlow: $('executeFlow'), runId: $('runId'),
  claimTicker: $('claimTicker'), latencyTicker: $('latencyTicker'), ledgerTicker: $('ledgerTicker'),
  auditState: $('auditState'), entitlementState: $('entitlementState'), breachLine: $('breachLine'), auditFoot: $('auditFoot'), breachBadge: $('breachBadge'), evidenceState: $('evidenceState'),
  claimAmount: $('claimAmount'), penaltyAmount: $('penaltyAmount'), citation: $('citation'), claimDelta: $('claimDelta'),
  telemetryStream: $('telemetryStream'), telemetryEmpty: $('telemetryEmpty'),
  receiptCard: $('receiptCard'), receiptAction: $('receiptAction'), receiptTimestamp: $('receiptTimestamp'), receiptClaimHash: $('receiptClaimHash'), receiptHash: $('receiptHash'), receiptCitation: $('receiptCitation'), downloadReceipt: $('downloadReceipt'),
  authorizationModal: $('authorizationModal'), authorizeAction: $('authorizeAction'), cancelAuthorization: $('cancelAuthorization'), modalClaim: $('modalClaim'), modalCitation: $('modalCitation'), modalIntentHash: $('modalIntentHash')
};

let runtime;
let downloadableReceipt = null;
let currentRun = null;
let telemetryCount = 0;

function setClock() {
  $('clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
}
setClock();
setInterval(setClock, 1000);

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 210 ? `${text.slice(0, 207)}…` : text;
  } catch { return '[unserializable]'; }
}

function renderTelemetry(event) {
  if (ui.telemetryEmpty?.isConnected) ui.telemetryEmpty.remove();
  const node = document.createElement('div');
  node.className = `telemetry-event ${event.kind || 'call'}`;
  const kind = (event.kind || 'EVENT').toUpperCase();
  const latency = typeof event.latency_ms === 'number' ? `${event.latency_ms.toFixed(1)} ms` : event.kind === 'schema' ? (event.valid ? 'VALID' : 'INVALID') : '—';
  const payload = event.kind === 'result' ? event.output : event.input ?? event.error ?? event.source;
  node.innerHTML = `
    <div class="telemetry-event-head">
      <span class="telemetry-kind">${kind}</span>
      <span class="telemetry-tool">${event.tool || 'webmcp.runtime'}</span>
      <span class="telemetry-latency ${event.kind === 'schema' && event.valid ? 'telemetry-valid' : ''}">${latency}</span>
    </div>
    <div class="telemetry-payload"></div>`;
  node.querySelector('.telemetry-payload').textContent = safeJson(payload);
  ui.telemetryStream.prepend(node);
  telemetryCount += 1;
  while (ui.telemetryStream.children.length > 7) ui.telemetryStream.lastElementChild?.remove();
  if (typeof event.latency_ms === 'number') ui.latencyTicker.textContent = `${event.latency_ms.toFixed(1)} ms`;
}

function setStage(index, state) {
  const stage = document.querySelector(`[data-stage="${index}"]`);
  if (!stage) return;
  stage.classList.remove('is-ready', 'is-active', 'is-complete', 'is-error');
  const labels = { ready: 'READY', active: 'RUNNING', complete: 'VERIFIED', error: 'HALTED', queued: 'QUEUED' };
  if (state !== 'queued') stage.classList.add(`is-${state}`);
  stage.querySelector('.stage-state').textContent = labels[state] || state.toUpperCase();
}

function resetFlowUi() {
  for (let index = 1; index <= 5; index += 1) setStage(index, index === 1 ? 'ready' : 'queued');
  ui.auditState.className = 'state-pill'; ui.auditState.textContent = 'STANDBY';
  ui.entitlementState.className = 'state-pill'; ui.entitlementState.textContent = 'STANDBY';
  ui.breachLine.classList.remove('detected');
  ui.auditFoot.textContent = 'Awaiting autonomous audit';
  ui.breachBadge.classList.remove('detected'); ui.breachBadge.textContent = 'NO CALLS YET';
  ui.claimAmount.classList.remove('live'); ui.claimAmount.textContent = '$0.00';
  ui.claimTicker.textContent = '$0.00'; ui.penaltyAmount.textContent = '$0.00'; ui.citation.textContent = 'Pending calculation';
  ui.claimDelta.textContent = 'principal + statutory interest';
  ui.receiptCard.classList.remove('ready');
  ui.downloadReceipt.disabled = true;
  downloadableReceipt = null;
}

function animateMoney(element, ticker, target, duration = 760) {
  if (prefersReducedMotion) { element.textContent = money(target); if (ticker) ticker.textContent = money(target); return Promise.resolve(); }
  return new Promise((resolve) => {
    const started = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      const value = target * eased;
      element.textContent = money(value);
      if (ticker) ticker.textContent = money(value);
      if (progress < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function waitForHumanAuthorization(summary, intentHash) {
  ui.modalClaim.textContent = money(summary.claim_total);
  ui.modalCitation.textContent = summary.statutory_citation;
  ui.modalIntentHash.textContent = compactHash(intentHash);
  ui.authorizationModal.hidden = false;
  ui.authorizeAction.focus();

  return new Promise((resolve, reject) => {
    const approve = async () => {
      cleanup();
      const approvedAt = new Date().toISOString();
      const proofHash = await sha256({
        action: 'AUTHORIZE_ENFORCEMENT',
        intent_hash: intentHash,
        approved_at: approvedAt,
        nonce: crypto.randomUUID(),
        gesture: 'single-click'
      });
      ui.authorizationModal.hidden = true;
      resolve({ proofHash, approvedAt });
    };
    const cancel = () => {
      cleanup();
      ui.authorizationModal.hidden = true;
      reject(new Error('Human authorization declined'));
    };
    const cleanup = () => {
      ui.authorizeAction.removeEventListener('click', approve);
      ui.cancelAuthorization.removeEventListener('click', cancel);
    };
    ui.authorizeAction.addEventListener('click', approve, { once: true });
    ui.cancelAuthorization.addEventListener('click', cancel, { once: true });
  });
}

function escapePdfText(value) {
  return String(value).replace(/[§–—]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1');
}

function makeReceiptPdf(lines) {
  const commands = ['BT', '/F1 11 Tf', '54 756 Td'];
  lines.forEach((line, index) => {
    if (index) commands.push('0 -22 Td');
    commands.push(`(${escapePdfText(line)}) Tj`);
  });
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function prepareReceiptDownload(notice, receipt, penalty) {
  downloadableReceipt = makeReceiptPdf([
    'ADVOCATE - VERIFIED ACTION RECEIPT',
    `Action ID: ${receipt.action_id}`,
    `Recorded: ${receipt.filed_at}`,
    `Claim amount: ${money(notice.demand_amount)}`,
    `Claim hash: ${receipt.claim_hash}`,
    `Approval proof: ${receipt.proof_hash}`,
    `Receipt hash: ${receipt.receipt_hash}`,
    `Statutory citation: ${penalty.statutory_citation.replace('§', 'Sec.')}`,
    'Ledger status: VERIFIED / RECORDED',
    'Demo workflow only - verify legal rules before production use.'
  ]);
  ui.downloadReceipt.disabled = false;
}

function populateReceipt(notice, receipt, penalty) {
  ui.receiptAction.textContent = receipt.action_id;
  ui.receiptTimestamp.textContent = new Date(receipt.filed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  ui.receiptClaimHash.textContent = compactHash(receipt.claim_hash);
  ui.receiptHash.textContent = compactHash(receipt.receipt_hash);
  ui.receiptCitation.textContent = penalty.statutory_citation;
  ui.receiptCard.classList.add('ready');
  prepareReceiptDownload(notice, receipt, penalty);
}

async function runEnforcementFlow() {
  if (currentRun) return;
  resetFlowUi();
  currentRun = `RUN-${Date.now().toString(36).toUpperCase()}`;
  ui.runId.textContent = currentRun;
  ui.executeFlow.disabled = true;
  ui.executeFlow.classList.add('running');
  ui.systemStatus.textContent = 'FLOW ACTIVE';

  try {
    setStage(1, 'active');
    ui.auditState.classList.add('active'); ui.auditState.textContent = 'STREAMING';
    await sleep(330);
    const clauseResult = await runtime.invoke('fetch_contract_clause', { clause_id: 'payment_terms_7_4' }, 'advocate-demo-agent');
    const clause = clauseResult.clause;
    ui.breachLine.classList.add('detected');
    ui.auditFoot.textContent = `${clause.breach_term} term exceeded by 32 days`;
    ui.breachBadge.classList.add('detected'); ui.breachBadge.textContent = 'BREACH VERIFIED';
    ui.auditState.className = 'state-pill complete'; ui.auditState.textContent = 'VERIFIED';
    setStage(1, 'complete');

    setStage(2, 'active');
    ui.entitlementState.classList.add('active'); ui.entitlementState.textContent = 'CALCULATING';
    await sleep(280);
    const penalty = await runtime.invoke('compute_statutory_penalty', { jurisdiction: 'CA', delay_days: 47, base_amount: 12840 }, 'advocate-demo-agent');
    ui.penaltyAmount.textContent = money(penalty.statutory_penalty);
    ui.citation.textContent = penalty.statutory_citation;
    ui.claimDelta.textContent = `${money(penalty.base_amount)} + ${money(penalty.statutory_penalty)} statutory component`;
    ui.claimAmount.classList.add('live');
    await animateMoney(ui.claimAmount, ui.claimTicker, penalty.claim_total);
    ui.entitlementState.className = 'state-pill complete'; ui.entitlementState.textContent = 'CALCULATED';
    setStage(2, 'complete');

    setStage(3, 'active');
    ui.systemStatus.textContent = 'AWAITING HUMAN';
    const intentPayload = {
      case_id: 'INV-0427', claimant: 'Northstar Studio LLC', counterparty: 'Atlas Procurement Inc.',
      clause_id: clause.clause_id, breach_clause: clause.heading, base_amount: penalty.base_amount,
      statutory_penalty: penalty.statutory_penalty, claim_total: penalty.claim_total, statutory_citation: penalty.statutory_citation
    };
    const intentHash = await sha256(intentPayload);
    const authorization = await waitForHumanAuthorization(penalty, intentHash);
    setStage(3, 'complete');

    setStage(4, 'active');
    ui.systemStatus.textContent = 'AGENT EXECUTING';
    await sleep(220);
    const noticeResult = await runtime.invoke('generate_enforceable_demand_notice', {
      claim_payload: {
        ...intentPayload,
        claimant: 'Northstar Studio LLC',
        counterparty: 'Atlas Procurement Inc.',
        delay_days: 47,
        authorization_proof: authorization.proofHash,
        approved_at: authorization.approvedAt
      }
    }, 'advocate-demo-agent');
    await sleep(300);
    const filingResult = await runtime.invoke('file_dispute_record', {
      action_id: noticeResult.notice.action_id,
      proof_hash: authorization.proofHash
    }, 'advocate-demo-agent');
    setStage(4, 'complete');

    setStage(5, 'active');
    await sleep(260);
    populateReceipt(noticeResult.notice, filingResult.receipt, penalty);
    ui.ledgerTicker.textContent = String(runtime.receiptCount).padStart(2, '0');
    setStage(5, 'complete');
    ui.systemStatus.textContent = 'RECEIPT VERIFIED';
    ui.receiptCard.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  } catch (error) {
    const active = document.querySelector('.stage.is-active');
    if (active) setStage(Number(active.dataset.stage), 'error');
    ui.systemStatus.textContent = error instanceof Error && error.message.includes('declined') ? 'RUN CANCELLED' : 'FLOW HALTED';
    renderTelemetry({ kind: 'error', tool: 'flow.controller', error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
  } finally {
    currentRun = null;
    ui.executeFlow.disabled = false;
    ui.executeFlow.classList.remove('running');
  }
}

ui.executeFlow.addEventListener('click', runEnforcementFlow);
ui.downloadReceipt.addEventListener('click', () => {
  if (!downloadableReceipt) return;
  const url = URL.createObjectURL(downloadableReceipt);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ui.receiptAction.textContent || 'advocate'}-verified-receipt.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const installation = await installAdvocateWebMcp({ telemetrySink: renderTelemetry });
runtime = installation.runtime;
$('toolTicker').textContent = String(runtime.tools.length).padStart(2, '0');
if (installation.native) {
  ui.protocolBadge.textContent = `WEBMCP · NATIVE ${installation.registered}/4`;
  ui.protocolBadge.classList.add('native');
} else {
  ui.protocolBadge.textContent = `WEBMCP · MIRROR ${runtime.tools.length}/4`;
}
renderTelemetry({ kind: 'runtime', tool: 'webmcp.registration', source: installation.native ? `${installation.registered} native browser tools registered` : 'Canonical API unavailable; window.__webmcp mirror armed', at: new Date().toISOString() });
