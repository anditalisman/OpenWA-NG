import { resolveSessionScope, sessionScopeVisible } from './session-scope';

// The key's allowedSessions is authoritative: a query-supplied sessionId may only NARROW within it,
// never broaden it. null/undefined = "no filter (see all)" — ADMIN only. An explicit [] is NOT the
// same as null: it's a non-admin unscoped key that owns no sessions (see
// AuthService.resolveEffectiveAllowedSessions), and must resolve to "see nothing".
describe('resolveSessionScope', () => {
  it('unrestricted key (null/undefined allowlist) with no requested session => no filter', () => {
    expect(resolveSessionScope(null)).toBeNull();
    expect(resolveSessionScope(undefined)).toBeNull();
  });

  it('an explicit empty allowlist is scoped, not unrestricted => empty filter, not null', () => {
    expect(resolveSessionScope([])).toEqual([]);
  });

  it('unrestricted key narrows to the requested session', () => {
    expect(resolveSessionScope(null, 'X')).toEqual(['X']);
  });

  it('an explicit empty allowlist stays empty even when a session is requested', () => {
    expect(resolveSessionScope([], 'X')).toEqual([]);
  });

  it('scoped key with no requested session => the whole allowlist', () => {
    expect(resolveSessionScope(['A', 'B'])).toEqual(['A', 'B']);
  });

  it('scoped key narrows to a requested session that is inside its allowlist', () => {
    expect(resolveSessionScope(['A', 'B'], 'A')).toEqual(['A']);
  });

  it('scoped key requesting a session OUTSIDE its allowlist => empty (match nothing), not the request', () => {
    expect(resolveSessionScope(['A', 'B'], 'C')).toEqual([]);
  });
});

// sessionScopeVisible fences resources whose session binding travels in a body field or a persisted
// row (plugin instances), which the guard's route-param fence cannot reach. null/'*' = all sessions.
describe('sessionScopeVisible', () => {
  it('unrestricted key (null/undefined allowlist) sees every scope', () => {
    expect(sessionScopeVisible(null, 'A')).toBe(true);
    expect(sessionScopeVisible(undefined, null)).toBe(true);
    expect(sessionScopeVisible(null, null)).toBe(true);
    expect(sessionScopeVisible(null, '*')).toBe(true);
  });

  it('an explicit empty allowlist sees nothing (non-admin unscoped key that owns no sessions)', () => {
    expect(sessionScopeVisible([], 'A')).toBe(false);
    expect(sessionScopeVisible([], null)).toBe(false);
    expect(sessionScopeVisible([], '*')).toBe(false);
  });

  it('scoped key sees resources bound to one of its own sessions only', () => {
    expect(sessionScopeVisible(['A', 'B'], 'A')).toBe(true);
    expect(sessionScopeVisible(['A', 'B'], 'C')).toBe(false);
  });

  it('scoped key never sees the all-sessions scope (null/undefined/*)', () => {
    expect(sessionScopeVisible(['A'], null)).toBe(false);
    expect(sessionScopeVisible(['A'], undefined)).toBe(false);
    expect(sessionScopeVisible(['A'], '*')).toBe(false);
  });
});
