/**
 * Resolve the effective session filter for a scoped read. The calling key's `allowedSessions` is
 * authoritative: a request-supplied `sessionId` may only narrow WITHIN that scope, never broaden it.
 * This is the shared fix for endpoints that accept `sessionId` as a query param, which the
 * ApiKeyGuard's route-param-only fence does not cover (see audit + webhook delivery-failures).
 *
 * Returns:
 *   - `null`     → no filter; the caller queries all sessions (unrestricted key, no narrowing)
 *   - `string[]` (non-empty) → filter `sessionId IN (...)` (the whole allowlist, or a single narrowed id)
 *   - `[]`       → the caller has zero visible sessions (an explicit `[]`, or the requested session
 *                  fell outside a non-empty allowlist) — the caller must return nothing
 *
 * ONLY `null`/`undefined` means "unrestricted" (an ADMIN key, per AuthService.effectiveAllowedSessions).
 * An explicit `[]` is NOT the same as null — it's a non-admin unscoped key that hasn't created any
 * sessions yet (resolveEffectiveAllowedSessions), and must resolve to "nothing visible", not "everything".
 */
export function resolveSessionScope(
  allowedSessions: string[] | null | undefined,
  requestedSessionId?: string,
): string[] | null {
  if (allowedSessions != null) {
    return requestedSessionId ? allowedSessions.filter(s => s === requestedSessionId) : allowedSessions;
  }
  return requestedSessionId ? [requestedSessionId] : null;
}

/**
 * True when `sessionScope` — a resource's session binding, where null/undefined means "all
 * sessions" — falls inside the calling key's `allowedSessions`. An unrestricted key (`allowedSessions`
 * null/undefined) sees every scope; a scoped key — including an explicit `[]`, which sees NOTHING, not
 * everything (see resolveSessionScope's doc) — only sees resources bound to one of its own sessions,
 * so a null scope (and the '*' wildcard) is never inside its fence. Use this on surfaces whose session
 * binding travels in the request body or in persisted rows, which the ApiKeyGuard's route-param
 * fence cannot reach (the same body/persisted-scope pattern the integration-instance controller
 * uses to confine a scoped key to instances bound inside its allowedSessions).
 */
export function sessionScopeVisible(
  allowedSessions: string[] | null | undefined,
  sessionScope: string | null | undefined,
): boolean {
  if (allowedSessions == null) return true;
  return sessionScope != null && sessionScope !== '*' && allowedSessions.includes(sessionScope);
}
