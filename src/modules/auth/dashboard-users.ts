import { ApiKeyRole } from './entities/api-key.entity';

export interface DashboardUserSpec {
  email: string;
  role: ApiKeyRole;
  allowedSessions: string[] | null;
}

/**
 * Parses DASHBOARD_USERS: comma-separated `email:role[:sessionId|sessionId...]` entries, e.g.
 * `hary@x.com:admin,miracle@x.com:operator:4c18a72f-...`. Throws on a malformed entry so a typo
 * fails the boot instead of silently locking someone out.
 */
export function parseDashboardUsers(raw: string | undefined): DashboardUserSpec[] {
  const roles = Object.values(ApiKeyRole) as string[];
  const seen = new Set<string>();
  return (raw || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [emailPart, rolePart, sessionsPart] = entry.split(':').map(p => p.trim());
      const email = (emailPart || '').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`DASHBOARD_USERS: "${entry}" does not start with a valid email`);
      }
      const role = (rolePart || '').toLowerCase();
      if (!roles.includes(role)) {
        throw new Error(`DASHBOARD_USERS: "${entry}" role must be one of ${roles.join(', ')}`);
      }
      if (seen.has(email)) {
        throw new Error(`DASHBOARD_USERS: ${email} is listed more than once`);
      }
      seen.add(email);
      const sessions = (sessionsPart || '')
        .split('|')
        .map(s => s.trim())
        .filter(Boolean);
      return { email, role: role as ApiKeyRole, allowedSessions: sessions.length > 0 ? sessions : null };
    });
}
