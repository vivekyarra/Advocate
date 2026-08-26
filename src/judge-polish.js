const STYLE_ID = 'advocate-judge-polish-css';
const NOTIFICATION_LIMIT = 12;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);
const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

export function installJudgePolishStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./judge-polish.css', import.meta.url).href;
  document.head.append(link);
}

export function agentStatusPresentation({ supported = false, count = 16 } = {}) {
  const toolCount = Number(count) || 16;
  return supported
    ? {
        label: `Agent connected · ${toolCount} tools`,
        detail: 'WebMCP is connected in this browser. Your authorized agent can inspect and act on this signed-in account now.',
        state: 'Connected now'
      }
    : {
        label: `Agent-ready · ${toolCount} tools`,
        detail: `Advocate ships ${toolCount} production WebMCP tools. They connect automatically when this URL is opened in ChatGPT’s in-app browser or Chrome 149+ with WebMCP enabled.`,
        state: 'Production interface ready'
      };
}

export function relativeNotificationTime(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Account update';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(time));
}

export function normalizeNotificationPayload(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items.slice(0, NOTIFICATION_LIMIT) : [];
  return {
    readAt: payload.read_at || payload.readAt || null,
    unreadCount: Math.max(0, Number(payload.unread_count ?? payload.unreadCount ?? items.filter((item) => item.unread).length) || 0),
    items: items.map((item) => ({
      id: String(item.id || cryptoFallbackId()),
      type: String(item.type || item.kind || 'account'),
      title: String(item.title || 'Account update'),
      body: String(item.body || ''),
      createdAt: item.created_at || item.createdAt || new Date().toISOString(),
      target: String(item.target || 'overview'),
      unread: Boolean(item.unread)
    }))
  };
}

function cryptoFallbackId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function notificationIcon(type) {
  if (type === 'billing') return '$';
  if (type === 'service') return '↗';
  if (type === 'support') return '?';
  if (type === 'plan') return '⇄';
  return '✓';
}

function stateBalance(state = {}) {
  if (Number.isFinite(Number(state.balanceCents))) return Number(state.balanceCents);
  const current = state.bills?.find((bill) => bill.status === 'due') || state.bills?.[0];
  return Number(current?.originalAmountCents || 0) + (state.ledger || []).reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
}

function recoverable(state = {}) {
  const outage = state.outages?.find((item) => item.confirmed && item.creditEligible);
  const current = state.bills?.find((bill) => bill.status === 'due') || state.bills?.[0];
  const invalid = current?.charges?.find((charge) => charge.valid === false);
  return Number(outage?.creditCents || 0) + Number(invalid?.amountCents || 0);
}

export function workflowPresentation(state = {}) {
  const caseState = state.case || {};
  const discoveries = caseState.discoveries || {};
  const approval = caseState.approval || {};
  const actions = caseState.actions || {};
  const current = state.bills?.find((bill) => bill.status === 'due') || state.bills?.[0];
  const previous = state.bills?.find((bill) => bill.id !== current?.id);
  const outage = state.outages?.[0];
  const invalid = current?.charges?.find((charge) => charge.valid === false);
  const alt = state.planOptions?.find((plan) => plan.equivalentToCurrent);
  const recovery = recoverable(state);
  const writes = Number(Boolean(actions.outageCreditApplied)) + Number(Boolean(actions.invalidChargeRefunded)) + Number(Boolean(actions.planChanged));
  const discoveryCount = ['comparedBills', 'outageReviewed', 'creditChecked', 'chargeChecked', 'plansReviewed'].filter((key) => discoveries[key]).length;
  const fixesReady = Boolean(discoveries.creditChecked && discoveries.chargeChecked);

  if (caseState.status === 'resolved') {
    return {
      phase: 'resolved', step: '06', label: 'Resolved',
      title: `${money(recovery)} recovered. No support ticket.`,
      metric: money(stateBalance(state)), metricLabel: 'new balance',
      facts: [
        ['Outage credit', actions.outageCreditApplied ? 'Applied' : '—'],
        ['Bad fee', actions.invalidChargeRefunded ? 'Refunded' : '—'],
        ['Plan', actions.planChanged ? state.plan?.name || 'Changed' : 'Unchanged']
      ]
    };
  }

  if (approval.billFixes && (writes > 0 || ['in_progress', 'awaiting_plan_change'].includes(caseState.status))) {
    return {
      phase: 'executing', step: '05', label: 'Agent executing',
      title: 'The account is changing now.',
      metric: approval.planId ? `${writes}/3` : `${writes}/2`, metricLabel: 'writes complete',
      facts: [
        ['Credit', actions.outageCreditApplied ? 'Done' : 'Working'],
        ['Refund', actions.invalidChargeRefunded ? 'Done' : 'Working'],
        ['Plan', approval.planId ? (actions.planChanged ? 'Done' : 'Waiting') : 'Locked']
      ]
    };
  }

  if (approval.billFixes) {
    return {
      phase: 'authorized', step: '04', label: 'Human authorized',
      title: 'Permission granted. Money has not moved.',
      metric: money(recovery), metricLabel: 'authorized recovery',
      facts: [
        ['Human', 'Approved'],
        ['Agent', 'Waiting'],
        ['Next', '“Approved. Continue.”']
      ]
    };
  }

  if (fixesReady) {
    return {
      phase: 'ready', step: '03', label: 'Recovery found',
      title: `${money(recovery)} is recoverable now.`,
      metric: money(stateBalance(state) - recovery), metricLabel: 'after bill fixes',
      facts: [
        ['Outage', `+${money(outage?.creditCents || 0)}`],
        ['Bad fee', `+${money(invalid?.amountCents || 0)}`],
        ['Plan option', alt ? `Save ${money((state.plan?.monthlyCents || 0) - alt.monthlyCents)}/mo` : 'Checked']
      ]
    };
  }

  if (discoveryCount > 0 || caseState.status === 'investigating') {
    return {
      phase: 'investigating', step: '02', label: 'Agent proving it',
      title: 'Checking first-party account evidence.',
      metric: `${discoveryCount}/5`, metricLabel: 'checks complete',
      facts: [
        ['Bill spike', discoveries.comparedBills ? 'Explained' : 'Checking'],
        ['Outage', discoveries.creditChecked ? 'Eligible' : discoveries.outageReviewed ? 'Found' : 'Checking'],
        ['Charge', discoveries.chargeChecked ? 'Invalid' : 'Checking']
      ]
    };
  }

  const delta = Number(current?.originalAmountCents || 0) - Number(previous?.originalAmountCents || 0);
  return {
    phase: 'idle', step: '01', label: 'Problem detected',
    title: 'This bill should not need a support call.',
    metric: money(current?.originalAmountCents || 0), metricLabel: 'current bill',
    facts: [
      ['Last month', money(previous?.originalAmountCents || 0)],
      ['Increase', `+${money(delta)}`],
      ['Outage', outage ? `${Math.floor(outage.durationMinutes / 60)}h ${outage.durationMinutes % 60}m` : '—']
    ]
  };
}

export function createJudgeUX({ api, navigate, toolCount = 16 } = {}) {
  let mounted = false;
  let notificationData = { readAt: null, unreadCount: 0, items: [] };
  let agentStatus = { supported: false, count: toolCount };
  let notificationWrap = null;
  let notificationButton = null;
  let notificationMenu = null;
  let notificationBadge = null;
  let notificationList = null;
  let notificationSummary = null;
  let capabilityPill = null;
  let capabilityPanel = null;
  let caseTheater = null;
  let pendingApproval = null;
  let approving = false;

  const onDocumentClick = (event) => {
    if (notificationWrap && !notificationWrap.contains(event.target)) closeNotifications();
    if (capabilityPanel && capabilityPill && !capabilityPanel.contains(event.target) && !capabilityPill.contains(event.target)) closeCapability();
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    closeNotifications();
    closeCapability();
  };

  function closeNotifications() {
    notificationMenu?.classList.add('hidden');
    notificationButton?.setAttribute('aria-expanded', 'false');
  }

  function closeCapability() {
    capabilityPanel?.classList.add('hidden');
    capabilityPill?.setAttribute('aria-expanded', 'false');
  }

  function setAgentStatus(status = {}) {
    agentStatus = { supported: Boolean(status.supported), count: Number(status.count) || toolCount };
    if (!capabilityPill) return;
    const presentation = agentStatusPresentation(agentStatus);
    const copy = capabilityPill.querySelector('span:last-child');
    if (copy) copy.textContent = presentation.label;
    capabilityPill.classList.add('ready', 'agent-ready', 'capability-pill-clickable');
    capabilityPill.title = 'Open agent interface status';
    capabilityPill.setAttribute('role', 'button');
    capabilityPill.setAttribute('tabindex', '0');
    capabilityPill.setAttribute('aria-haspopup', 'true');
    capabilityPill.setAttribute('aria-expanded', 'false');
    if (capabilityPanel) {
      capabilityPanel.innerHTML = `<strong>Advocate agent interface</strong><span>${escapeHtml(presentation.detail)}</span><small class="capability-state"><span class="status-dot"></span>${escapeHtml(presentation.state)}</small>`;
    }
  }

  function renderNotifications() {
    if (!notificationList || !notificationBadge || !notificationSummary) return;
    const count = notificationData.unreadCount;
    notificationBadge.textContent = count > 99 ? '99+' : String(count);
    notificationBadge.classList.toggle('hidden', count === 0);
    notificationSummary.textContent = count ? `${count} unread` : 'All caught up';

    if (!notificationData.items.length) {
      notificationList.innerHTML = '<div class="notification-empty"><strong>No account notifications yet.</strong><br>Billing, service, support, and resolution updates will appear here automatically.</div>';
      return;
    }

    notificationList.innerHTML = notificationData.items.map((item) => `
      <button class="notification-item ${item.unread ? 'unread' : ''}" type="button" data-notification-target="${escapeHtml(item.target)}" data-notification-id="${escapeHtml(item.id)}">
        <span class="notification-icon" aria-hidden="true">${escapeHtml(notificationIcon(item.type))}</span>
        <span class="notification-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span><small>${escapeHtml(relativeNotificationTime(item.createdAt))}</small></span>
        ${item.unread ? '<span class="notification-unread-dot" aria-label="Unread"></span>' : '<span></span>'}
      </button>`).join('');
  }

  function renderWorkflow(snapshot) {
    const center = document.getElementById('resolutionCenter');
    if (!center) return;
    if (!caseTheater) {
      caseTheater = document.createElement('div');
      caseTheater.id = 'liveCaseTheater';
      caseTheater.className = 'case-theater';
      const heading = center.querySelector('.section-heading');
      heading?.after(caseTheater);
    }
    const view = workflowPresentation(snapshot);
    center.dataset.caseStage = view.phase;
    caseTheater.dataset.phase = view.phase;
    caseTheater.innerHTML = `
      <div class="case-theater-top"><span class="case-step">${escapeHtml(view.step)}</span><strong>${escapeHtml(view.label)}</strong><span class="case-live"><i></i>${view.phase === 'resolved' ? 'complete' : 'live case'}</span></div>
      <div class="case-theater-main"><strong class="case-title">${escapeHtml(view.title)}</strong><div class="case-metric"><strong>${escapeHtml(view.metric)}</strong><span>${escapeHtml(view.metricLabel)}</span></div></div>
      <div class="case-facts">${view.facts.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`;
  }

  async function refreshWorkflow() {
    if (!api?.rpc || !mounted) return null;
    try {
      const snapshot = await api.rpc('get_app_state');
      renderWorkflow(snapshot);
      return snapshot;
    } catch (error) {
      console.error('Live case sync failed', error);
      return null;
    }
  }

  async function refreshNotifications() {
    if (!api?.rpc || !mounted) return notificationData;
    try {
      const payload = await api.rpc('get_notifications');
      notificationData = normalizeNotificationPayload(payload);
      renderNotifications();
    } catch (error) {
      console.error('Notification sync failed', error);
      notificationData = { readAt: null, unreadCount: 0, items: [] };
      if (notificationSummary) notificationSummary.textContent = 'Secure sync';
      if (notificationList) notificationList.innerHTML = '<div class="notification-empty">Account notifications could not be refreshed. Your account data and actions remain available.</div>';
    }
    await refreshWorkflow();
    return notificationData;
  }

  async function markNotificationsRead() {
    if (!api?.rpc || notificationData.unreadCount === 0) return;
    try {
      const result = await api.rpc('mark_notifications_read');
      notificationData = {
        ...notificationData,
        readAt: result?.read_at || new Date().toISOString(),
        unreadCount: 0,
        items: notificationData.items.map((item) => ({ ...item, unread: false }))
      };
      renderNotifications();
    } catch (error) {
      console.error('Could not persist notification read state', error);
    }
  }

  async function toggleNotifications() {
    if (!notificationMenu) return;
    const opening = notificationMenu.classList.contains('hidden');
    closeCapability();
    notificationMenu.classList.toggle('hidden', !opening);
    notificationButton?.setAttribute('aria-expanded', String(opening));
    if (opening) {
      await refreshNotifications();
      await markNotificationsRead();
    }
  }

  function toggleCapability() {
    if (!capabilityPanel) return;
    const opening = capabilityPanel.classList.contains('hidden');
    closeNotifications();
    capabilityPanel.classList.toggle('hidden', !opening);
    capabilityPill?.setAttribute('aria-expanded', String(opening));
  }

  function mountCapability() {
    capabilityPill = document.getElementById('webMcpStatus');
    const topbarRight = document.querySelector('.topbar-right');
    if (!capabilityPill || !topbarRight) return;
    capabilityPanel = document.getElementById('capabilityPanel');
    if (!capabilityPanel) {
      capabilityPanel = document.createElement('div');
      capabilityPanel.id = 'capabilityPanel';
      capabilityPanel.className = 'capability-panel hidden';
      capabilityPanel.setAttribute('role', 'status');
      topbarRight.append(capabilityPanel);
    }
    capabilityPill.addEventListener('click', toggleCapability);
    capabilityPill.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleCapability();
      }
    });
    setAgentStatus(agentStatus);
  }

  function mountNotifications() {
    const profileWrap = document.querySelector('.profile-menu-wrap');
    if (!profileWrap || document.getElementById('notificationButton')) return;
    notificationWrap = document.createElement('div');
    notificationWrap.className = 'notification-wrap';
    notificationWrap.innerHTML = `
      <button id="notificationButton" class="notification-button" type="button" aria-label="Open notifications" aria-haspopup="true" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
        <span id="notificationBadge" class="notification-badge hidden">0</span>
      </button>
      <div id="notificationMenu" class="notification-menu hidden" role="dialog" aria-label="Account notifications">
        <div class="notification-head"><strong>Notifications</strong><span id="notificationSummary">Secure sync</span></div>
        <div id="notificationList" class="notification-list"><div class="notification-empty">Loading account notifications…</div></div>
        <div class="notification-foot">Synced from your authenticated Advocate account</div>
      </div>`;
    profileWrap.before(notificationWrap);
    notificationButton = notificationWrap.querySelector('#notificationButton');
    notificationMenu = notificationWrap.querySelector('#notificationMenu');
    notificationBadge = notificationWrap.querySelector('#notificationBadge');
    notificationList = notificationWrap.querySelector('#notificationList');
    notificationSummary = notificationWrap.querySelector('#notificationSummary');
    notificationButton.addEventListener('click', toggleNotifications);
    notificationList.addEventListener('click', (event) => {
      const item = event.target.closest('[data-notification-target]');
      if (!item) return;
      closeNotifications();
      navigate?.(item.dataset.notificationTarget || 'overview');
    });
  }

  function openApprovalGate(includePlan, snapshot) {
    const dialog = document.getElementById('confirmDialog');
    if (!dialog) return;
    const recovery = recoverable(snapshot);
    const alt = snapshot.planOptions?.find((plan) => plan.equivalentToCurrent) || snapshot.planOptions?.[0] || null;
    pendingApproval = { includePlan, planId: includePlan ? alt?.id || null : null };
    const title = dialog.querySelector('#dialogTitle');
    const message = dialog.querySelector('#dialogMessage');
    const details = dialog.querySelector('#dialogDetails');
    const confirm = dialog.querySelector('#dialogConfirm');
    const cancel = dialog.querySelector('#dialogCancel');
    if (title) title.textContent = includePlan ? 'Authorize fixes + this plan?' : 'Authorize the verified recovery?';
    if (message) message.textContent = 'You authorize. Your agent executes. The backend enforces the boundary.';
    if (details) details.innerHTML = `
      <div class="approval-proof"><span>Recovery</span><strong>${escapeHtml(money(recovery))}</strong></div>
      <div class="approval-proof"><span>Plan</span><strong>${includePlan && alt ? escapeHtml(`${alt.name} · ${money(alt.monthlyCents)}/mo`) : 'No change authorized'}</strong></div>
      <div class="approval-proof"><span>Money moves now</span><strong>No</strong></div>`;
    if (confirm) {
      confirm.textContent = 'Authorize agent';
      confirm.className = 'button primary';
      confirm.disabled = false;
    }
    if (cancel) {
      cancel.textContent = 'Cancel';
      cancel.classList.remove('hidden');
    }
    if (!dialog.open) dialog.showModal();
  }

  async function onApprovalClick(event) {
    if (!mounted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const includePlan = event.currentTarget?.id === 'approveBillAndPlan';
    const snapshot = await refreshWorkflow();
    if (snapshot) openApprovalGate(includePlan, snapshot);
  }

  async function onDialogConfirm(event) {
    if (!pendingApproval || approving) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const dialog = document.getElementById('confirmDialog');
    const confirm = document.getElementById('dialogConfirm');
    const message = document.getElementById('dialogMessage');
    approving = true;
    if (confirm) {
      confirm.disabled = true;
      confirm.textContent = 'Authorizing…';
    }
    try {
      await api.rpc('grant_resolution_approval', {
        p_include_plan: pendingApproval.includePlan,
        p_plan_id: pendingApproval.planId || 'fiber-500-flex'
      });
      document.getElementById('approvalActions')?.classList.add('hidden');
      const notice = document.getElementById('approvalNotice');
      if (notice) {
        notice.classList.remove('hidden');
        notice.innerHTML = pendingApproval.includePlan
          ? '<strong>Authorized.</strong> Agent may apply the bill fixes and the selected plan.'
          : '<strong>Authorized.</strong> Agent may apply bill fixes. Plan changes remain blocked.';
      }
      pendingApproval = null;
      dialog?.close('confirm');
      navigate?.('overview');
      await refreshWorkflow();
    } catch (error) {
      console.error('Approval failed', error);
      if (message) message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      approving = false;
      if (confirm) {
        confirm.disabled = false;
        confirm.textContent = 'Authorize agent';
      }
    }
  }

  function onApprovalDialogClose() {
    pendingApproval = null;
  }

  function mountApprovalGate() {
    document.getElementById('approveBillOnly')?.addEventListener('click', onApprovalClick, true);
    document.getElementById('approveBillAndPlan')?.addEventListener('click', onApprovalClick, true);
    document.getElementById('dialogConfirm')?.addEventListener('click', onDialogConfirm, true);
    document.getElementById('confirmDialog')?.addEventListener('close', onApprovalDialogClose);
  }

  async function init() {
    if (mounted) return;
    installJudgePolishStyles();
    mounted = true;
    mountNotifications();
    mountCapability();
    mountApprovalGate();
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    await refreshNotifications();
  }

  function destroy() {
    if (!mounted) return;
    mounted = false;
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeyDown);
    document.getElementById('approveBillOnly')?.removeEventListener('click', onApprovalClick, true);
    document.getElementById('approveBillAndPlan')?.removeEventListener('click', onApprovalClick, true);
    document.getElementById('dialogConfirm')?.removeEventListener('click', onDialogConfirm, true);
    document.getElementById('confirmDialog')?.removeEventListener('close', onApprovalDialogClose);
    notificationWrap?.remove();
    capabilityPanel?.remove();
    caseTheater?.remove();
    const center = document.getElementById('resolutionCenter');
    if (center) delete center.dataset.caseStage;
    if (capabilityPill) {
      capabilityPill.classList.remove('agent-ready', 'capability-pill-clickable');
      capabilityPill.removeAttribute('role');
      capabilityPill.removeAttribute('tabindex');
      capabilityPill.removeAttribute('aria-haspopup');
      capabilityPill.removeAttribute('aria-expanded');
    }
  }

  return { init, destroy, refreshNotifications, refreshWorkflow, setAgentStatus };
}
