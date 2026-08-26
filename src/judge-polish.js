const STYLE_ID = 'advocate-judge-polish-css';
const NOTIFICATION_LIMIT = 12;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);

export function installJudgePolishStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/src/judge-polish.css';
  document.head.append(link);
}

export function agentStatusPresentation({ supported = false, count = 14 } = {}) {
  const toolCount = Number(count) || 14;
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

export function createJudgeUX({ api, navigate, toolCount = 14 } = {}) {
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

  async function init() {
    if (mounted) return;
    installJudgePolishStyles();
    mounted = true;
    mountNotifications();
    mountCapability();
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    await refreshNotifications();
  }

  function destroy() {
    if (!mounted) return;
    mounted = false;
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeyDown);
    notificationWrap?.remove();
    capabilityPanel?.remove();
    if (capabilityPill) {
      capabilityPill.classList.remove('agent-ready', 'capability-pill-clickable');
      capabilityPill.removeAttribute('role');
      capabilityPill.removeAttribute('tabindex');
      capabilityPill.removeAttribute('aria-haspopup');
      capabilityPill.removeAttribute('aria-expanded');
    }
  }

  return { init, destroy, refreshNotifications, setAgentStatus };
}
