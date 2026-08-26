import { AdvocateAuthClient, DataApiClient, createCloudAdvocateService } from './cloud.js';
import { registerAdvocateTools, createToolDefinitions } from './webmcp.js';
import { createUI } from './ui.js';
import { createJudgeUX, installJudgePolishStyles } from './judge-polish.js';

installJudgePolishStyles();

const $ = (selector) => document.querySelector(selector);
const auth = new AdvocateAuthClient();
let activeService = null;
let ui = null;
let judgeUX = null;
let toolsRegistered = false;

const serviceRouter = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'then') return undefined;
    return (...args) => {
      if (!activeService || typeof activeService[prop] !== 'function') throw new Error('Sign in to use this Advocate account tool.');
      return activeService[prop](...args);
    };
  }
});

const toolCount = createToolDefinitions(serviceRouter).length;

function authMessage(message = '', kind = 'error') {
  const box = $('#authMessage');
  if (!message) {
    box.textContent = '';
    box.className = 'form-message hidden';
    return;
  }
  box.textContent = message;
  box.className = `form-message ${kind === 'success' ? 'success' : ''}`.trim();
}

function setAuthBusy(value) {
  $('#authView').querySelectorAll('button,input').forEach((el) => { el.disabled = value; });
}

function setAuthTab(tab) {
  const signIn = tab === 'signin';
  $('#signInTab').classList.toggle('active', signIn);
  $('#signUpTab').classList.toggle('active', !signIn);
  $('#signInTab').setAttribute('aria-selected', String(signIn));
  $('#signUpTab').setAttribute('aria-selected', String(!signIn));
  $('#signInPanel').classList.toggle('hidden', !signIn);
  $('#signUpPanel').classList.toggle('hidden', signIn);
  authMessage();
}

function showAuth() {
  judgeUX?.destroy();
  judgeUX = null;
  activeService = null;
  ui = null;
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  document.title = 'Advocate — Sign in';
  history.replaceState(null, '', location.pathname);
  setAuthBusy(false);
}

async function ensureTools() {
  if (toolsRegistered) {
    const status = { supported: true, count: toolCount };
    ui?.setWebMcpStatus(status);
    judgeUX?.setAgentStatus(status);
    return status;
  }
  try {
    const status = await registerAdvocateTools(serviceRouter);
    toolsRegistered = status.supported;
    if (status.supported) ui?.setWebMcpStatus(status);
    judgeUX?.setAgentStatus({ ...status, count: status.count || toolCount });
    return status;
  } catch (error) {
    console.error('WebMCP registration failed', error);
    const status = { supported: false, count: toolCount, error: error instanceof Error ? error.message : String(error) };
    judgeUX?.setAgentStatus(status);
    return status;
  }
}

async function startApp(session, { name = null, demo = false } = {}) {
  const api = new DataApiClient(() => auth.getJwt());
  await api.rpc('ensure_advocate_account', { p_name: name, p_demo: demo });

  let nextUI = null;
  let nextJudgeUX = null;
  activeService = createCloudAdvocateService(api, {
    onEvent: (event) => {
      nextUI?.onEvent(event);
      nextJudgeUX?.refreshNotifications();
    }
  });
  nextUI = createUI({
    service: activeService,
    auth,
    session,
    onSignOut: () => showAuth()
  });
  ui = nextUI;

  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  document.title = 'Advocate — Account';
  await ui.init();

  judgeUX?.destroy();
  nextJudgeUX = createJudgeUX({
    api,
    navigate: (panel) => ui?.activatePanel(panel),
    toolCount
  });
  judgeUX = nextJudgeUX;
  await judgeUX.init();

  const status = await ensureTools();
  if (status.supported) ui.setWebMcpStatus({ supported: true, count: toolCount });
  judgeUX.setAgentStatus({ supported: status.supported, count: toolCount });
}

async function resolveSession(preferred = null) {
  const session = preferred?.user ? preferred : await auth.getSession();
  if (!session?.user) return null;
  return session;
}

async function loginFlow(task, { name = null, demo = false } = {}) {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  setAuthBusy(true);
  authMessage();
  try {
    const response = await task();
    const session = await resolveSession(response?.user ? { user: response.user, session: response.session } : null);
    if (!session) throw new Error('Sign-in succeeded, but the browser could not establish a secure session. Please allow cookies for this site and try again.');
    await startApp(session, { name: name || session.user.name, demo });
  } catch (error) {
    console.error(error);
    authMessage(error instanceof Error ? error.message : String(error));
    setAuthBusy(false);
  }
}

async function createAccountAndSignIn({ name, email, password, demo = false }) {
  await auth.signUp({ name, email, password });
  return auth.signIn({ email, password, rememberMe: true });
}

function bindAuth() {
  $('#signInTab').addEventListener('click', () => setAuthTab('signin'));
  $('#signUpTab').addEventListener('click', () => setAuthTab('signup'));

  $('#signInForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const email = $('#signInEmail').value.trim().toLowerCase();
    const password = $('#signInPassword').value;
    if (!email || !password) return authMessage('Enter your email and password.');
    loginFlow(() => auth.signIn({ email, password, rememberMe: $('#rememberMe').checked }));
  });

  $('#signUpForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#signUpName').value.trim();
    const email = $('#signUpEmail').value.trim().toLowerCase();
    const password = $('#signUpPassword').value;
    const confirm = $('#signUpConfirm').value;
    if (name.length < 2) return authMessage('Enter your full name.');
    if (!email || !email.includes('@')) return authMessage('Enter a valid email address.');
    if (password.length < 10) return authMessage('Use at least 10 characters for your password.');
    if (password !== confirm) return authMessage('The passwords do not match.');
    loginFlow(() => createAccountAndSignIn({ name, email, password, demo: false }), { name, demo: false });
  });

  $('#demoAccess').addEventListener('click', () => {
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
    const email = `demo-${id}@demo.advocate.app`;
    const password = `Demo-${crypto.randomUUID()}-9a!`;
    loginFlow(() => createAccountAndSignIn({ name: 'Jordan Lee', email, password, demo: true }), { name: 'Jordan Lee', demo: true });
  });
}

bindAuth();

try {
  const session = await auth.getSession();
  if (session?.user) {
    setAuthBusy(true);
    await startApp(session, { name: session.user.name, demo: false });
  } else {
    showAuth();
  }
} catch (error) {
  console.error('Initial session bootstrap failed', error);
  showAuth();
  authMessage('Account services are temporarily unavailable. Please retry sign in.');
}

Object.defineProperty(window, '__ADVOCATE_TEST__', {
  value: {
    names: createToolDefinitions(serviceRouter).map((tool) => tool.name),
    invoke: async (name, input = {}) => {
      const tool = createToolDefinitions(serviceRouter).find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.execute(input);
    },
    state: () => activeService?.getState(),
    notifications: () => judgeUX?.refreshNotifications(),
    signedIn: () => Boolean(activeService)
  },
  writable: false,
  configurable: false
});
