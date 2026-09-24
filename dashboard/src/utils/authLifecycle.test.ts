import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { installJsdomGlobals as installJsdomGlobalsFn } from '../test-helpers/jsdom.ts';
import { clearActorState, isUserRole, resolveStartupValidation } from './authLifecycle.ts';

test('logout cleanup wipes the React Query cache (no cross-actor residue)', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['sessions'], [{ id: 's1' }]);
  queryClient.setQueryData(['apiKeys'], [{ id: 'k1' }]);
  queryClient.setQueryData(['logs', { page: 1 }], [{ id: 'a1' }]);

  clearActorState(queryClient);

  assert.equal(queryClient.getQueryData(['sessions']), undefined);
  assert.equal(queryClient.getQueryData(['apiKeys']), undefined);
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
});

test('logout cleanup calls clear() on every provided cache', () => {
  const calls: string[] = [];
  const cache = (name: string) => ({ clear: () => calls.push(name) });
  clearActorState(cache('a'), cache('b'));
  assert.deepEqual(calls, ['a', 'b']);
});

test('startup validation: 401/403 (revoked/demoted/restricted key) → logout', () => {
  assert.deepEqual(resolveStartupValidation(401, null), { action: 'logout' });
  assert.deepEqual(resolveStartupValidation(401, { valid: true, role: 'admin' }), { action: 'logout' });
  assert.deepEqual(resolveStartupValidation(403, null), { action: 'logout' });
});

test('startup validation: 429/5xx keeps the cached role (transient failure, not a revoked key)', () => {
  for (const status of [429, 500, 502, 503]) {
    assert.deepEqual(resolveStartupValidation(status, null), { action: 'keep' }, `status ${status}`);
    // Even a stray valid-looking body cannot upgrade a non-ok answer to a role refresh.
    assert.deepEqual(resolveStartupValidation(status, { valid: true, role: 'admin' }), { action: 'keep' });
  }
});

test('startup validation: ok + role refreshes the cached role from the server', () => {
  assert.deepEqual(resolveStartupValidation(200, { valid: true, role: 'viewer', dashboardSession: true }), {
    action: 'role',
    role: 'viewer',
  });
});

test('startup validation: a valid key that is not a dashboard login is logged out', () => {
  // Email + password is the only way in; a plain integration API key must not keep a session.
  assert.deepEqual(resolveStartupValidation(200, { valid: true, role: 'admin' }), { action: 'logout' });
  assert.deepEqual(resolveStartupValidation(200, { valid: true, role: 'admin', dashboardSession: false }), {
    action: 'logout',
  });
});

test('startup validation: ok without a usable role keeps the cached role', () => {
  assert.deepEqual(resolveStartupValidation(200, { valid: false }), { action: 'keep' });
  assert.deepEqual(resolveStartupValidation(200, { valid: true, role: 'superuser', dashboardSession: true }), {
    action: 'keep',
  });
  assert.deepEqual(resolveStartupValidation(200, null), { action: 'keep' });
});

test('isUserRole accepts exactly the three known roles', () => {
  assert.deepEqual(['admin', 'operator', 'viewer'].filter(isUserRole), ['admin', 'operator', 'viewer']);
  for (const value of ['superuser', '', undefined, null, 42, 'ADMIN']) {
    assert.equal(isUserRole(value), false, `expected ${String(value)} to be rejected`);
  }
});

// ── App-level auth flow: email + password sign-in, startup re-validation ──────
// Render smoke tests of the full App for the entry paths (fresh sign-in, page reload with a saved
// key). Harness mirrors Infrastructure.test.ts: jsdom globals, a fetch stub recording every
// call, i18n catalogues awaited before render. App brings its own providers, so no wrapper here.

const LOGIN_KEY = 'openwa_api_key';
const ROLE_KEY = 'openwa_user_role';

interface FetchCall {
  method: string;
  path: string;
}

const fetchCalls: FetchCall[] = [];

// Per-test body for POST /auth/validate. The home page's stats endpoints need their object shapes
// ([] would crash Dashboard's overview render); every other request gets an empty list, which the
// post-login pages' React Query hooks tolerate.
let validateBody: { valid?: boolean; role?: string; dashboardSession?: boolean } = {
  valid: true,
  role: 'operator',
  dashboardSession: true,
};
// Per-test body for POST /auth/dashboard/login (the email + password sign-in).
let loginBody: { apiKey: string; role?: string } = { apiKey: 'minted-key', role: 'operator' };

function installFetchStub(): void {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    fetchCalls.push({ method, path });

    let body: unknown = [];
    if (method === 'POST' && path === '/api/auth/validate') body = validateBody;
    else if (method === 'POST' && path === '/api/auth/dashboard/login') body = loginBody;
    else if (path === '/api/stats/overview')
      body = {
        sessions: { active: 0, total: 0, byStatus: {} },
        messages: { sent: 0, received: 0, failed: 0, today: { sent: 0, received: 0 } },
      };
    else if (path.startsWith('/api/stats/messages')) body = { timeSeries: [], byType: {}, bySession: [], topChats: [] };
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  };
}

function loginCallCount(): number {
  return fetchCalls.filter(c => c.method === 'POST' && c.path === '/api/auth/dashboard/login').length;
}

function validateCallCount(): number {
  return fetchCalls.filter(c => c.method === 'POST' && c.path === '/api/auth/validate').length;
}

type RTL = typeof import('@testing-library/react');
type AppModule = typeof import('../App.tsx');

let rtl: RTL;
let App: AppModule['default'];
let installJsdomGlobals: typeof installJsdomGlobalsFn;

before(async () => {
  ({ installJsdomGlobals } = await import('../test-helpers/jsdom.ts'));
  await installJsdomGlobals();
  installFetchStub();
  // jsdom gaps the authenticated shell hits: useTheme (Layout) reads window.matchMedia, and the
  // lazily-mounted analytics charts construct a ResizeObserver.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof window.matchMedia;
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  // Login.tsx reads these Vite compile-time defines at render time; Node has no define step.
  Object.defineProperty(globalThis, '__APP_VERSION__', { value: '0.0.0-test', configurable: true });
  Object.defineProperty(globalThis, '__BUILD_TIME__', { value: new Date(0).toISOString(), configurable: true });
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ default: App } = await import('../App.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls.length = 0;
  validateBody = { valid: true, role: 'operator', dashboardSession: true };
  loginBody = { apiKey: 'minted-key', role: 'operator' };
});

// Fills the email + password form and submits it, then waits until App has applied the role from
// the login response (the synchronous tail of handleLogin).
async function signIn(email: string, password: string): Promise<void> {
  const { screen, waitFor, fireEvent } = rtl;
  const emailInput = await screen.findByLabelText('Email');
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.submit(emailInput.closest('form')!);
  await waitFor(() => assert.ok(localStorage.getItem(ROLE_KEY), 'expected a role to be stored after sign-in'));
  // Give the post-login render and its effects a macrotask to fire before counting requests.
  await new Promise(resolve => setTimeout(resolve, 50));
}

test('the sign-in form asks for email and password, not an API key', async () => {
  rtl.render(createElement(App));
  await rtl.screen.findByLabelText('Email');
  assert.ok(rtl.screen.getByLabelText('Password'));
  assert.equal(rtl.screen.queryByLabelText('API Key'), null);
});

test('a fresh sign-in stores the minted key and role without an extra /auth/validate', async () => {
  rtl.render(createElement(App));

  await signIn('miracle@ptamgirimenang.com', 'correct horse battery');

  // The login response already carries the role; the startup re-validation effect must not re-fire
  // on the null→key transition that storing the fresh key causes.
  assert.equal(loginCallCount(), 1);
  assert.equal(validateCallCount(), 0);
  assert.equal(localStorage.getItem(ROLE_KEY), 'operator');
  assert.equal(sessionStorage.getItem(LOGIN_KEY), 'minted-key');
});

test('a fresh sign-in with a role-less login response still degrades to viewer', async () => {
  loginBody = { apiKey: 'minted-key' };
  rtl.render(createElement(App));

  await signIn('miracle@ptamgirimenang.com', 'correct horse battery');

  assert.equal(localStorage.getItem(ROLE_KEY), 'viewer');
});

test('a page reload with a saved dashboard key re-validates once at startup and refreshes the cached role', async () => {
  sessionStorage.setItem(LOGIN_KEY, 'saved-key');
  localStorage.setItem(ROLE_KEY, 'viewer'); // stale cached role
  validateBody = { valid: true, role: 'admin', dashboardSession: true };
  rtl.render(createElement(App));

  await rtl.waitFor(() => assert.equal(localStorage.getItem(ROLE_KEY), 'admin'));
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(validateCallCount(), 1);
});

test('a page reload with a plain API key (not a dashboard login) is signed out', async () => {
  sessionStorage.setItem(LOGIN_KEY, 'integration-key');
  localStorage.setItem(ROLE_KEY, 'admin');
  validateBody = { valid: true, role: 'admin', dashboardSession: false };
  rtl.render(createElement(App));

  await rtl.waitFor(() => assert.equal(sessionStorage.getItem(LOGIN_KEY), null));
  await rtl.screen.findByLabelText('Email');
});
