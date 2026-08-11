import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `createdByApiKeyId` to `sessions` — which API key's POST /sessions call created this row.
 *
 * Used by AuthService.validateApiKey to resolve a non-admin key's *effective* session scope: an
 * operator/viewer key with no explicit `allowedSessions` no longer sees every session in the
 * deployment, only the ones it created itself (ADMIN keeps the old "unscoped = everything"
 * behaviour). Plain string column, no FK — `sessions` lives on the `data` connection and `api_keys`
 * on the separate `main` connection, so no cross-connection foreign key is possible; the same reason
 * nothing else on this entity references ApiKey. NULL for every pre-existing row (created before
 * this feature existed) and for rows created by an admin key, which reads as "no creator on record" —
 * harmless, since only non-admin keys ever consult this column.
 *
 * Indexed: AuthService looks this column up on every request from a non-admin unscoped key, i.e.
 * potentially every authenticated call, not just session-management ones.
 *
 * Hand-authored because `synchronize` is off for the `data` connection on PostgreSQL. Idempotent,
 * following AddSessionOwnership's probe pattern.
 */
export class AddSessionCreatedByApiKey1786100000000 implements MigrationInterface {
  name = 'AddSessionCreatedByApiKey1786100000000';

  private async hasColumn(queryRunner: QueryRunner, name: string): Promise<boolean> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'sessions' AND column_name = '${name}'`,
      )) as unknown[];
      return rows.length > 0;
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("sessions")`)) as Array<{ name: string }>;
    return rows.some(r => r.name === name);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner, 'createdByApiKeyId'))) {
      await queryRunner.query(`ALTER TABLE "sessions" ADD COLUMN "createdByApiKeyId" varchar(36) NULL`);
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sessions_createdByApiKeyId" ON "sessions" ("createdByApiKeyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessions_createdByApiKeyId"`);
    if (await this.hasColumn(queryRunner, 'createdByApiKeyId')) {
      await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "createdByApiKeyId"`);
    }
  }
}
