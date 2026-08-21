import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs the self-service "forgot key" recovery flow: revoke whatever active key(s) a verified
 * email owns and issue a fresh one, the same shape as password-reset — never "resend the old key",
 * because ApiKey.keyHash (like a password hash) makes the raw key unrecoverable once issued.
 *
 * Two additive changes on the **main** connection (always SQLite, see CreateAuthAuditTables):
 * - `api_keys.selfServiceEmail`: the verified email a self-service-issued key belongs to (null for
 *   keys an admin created directly). This is the lookup recovery needs and the original self-service
 *   flow never persisted — retrofitted here so keys issued before this migration can still be found
 *   once SelfServiceApiKeyService.verifyAndIssue starts setting it (no backfill: there is no way to
 *   recover which email an already-issued key belongs to after the fact, so pre-existing self-service
 *   keys simply stay unrecoverable via this flow, same as any admin-created key).
 * - `api_key_self_service_requests.purpose`: distinguishes the existing "issue a new key" request row
 *   from a "recover access" one, reusing the same token/expiry/single-use columns and enforcement
 *   instead of duplicating that table.
 */
export class AddSelfServiceRecovery1786300000000 implements MigrationInterface {
  name = 'AddSelfServiceRecovery1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const apiKeysColumns = (await queryRunner.query(`PRAGMA table_info("api_keys")`)) as Array<{ name: string }>;
    if (!apiKeysColumns.some(c => c.name === 'selfServiceEmail')) {
      await queryRunner.query(`ALTER TABLE "api_keys" ADD COLUMN "selfServiceEmail" varchar(255)`);
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_api_keys_selfServiceEmail" ON "api_keys" ("selfServiceEmail")`,
    );

    const requestColumns = (await queryRunner.query(`PRAGMA table_info("api_key_self_service_requests")`)) as Array<{
      name: string;
    }>;
    if (!requestColumns.some(c => c.name === 'purpose')) {
      await queryRunner.query(
        `ALTER TABLE "api_key_self_service_requests" ADD COLUMN "purpose" varchar(20) NOT NULL DEFAULT ('issue')`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SQLite has no DROP COLUMN pre-3.35 without a table rebuild; dropping the index is enough to
    // undo the query-plan effect, and leaving the (unused) columns behind is harmless — same
    // trade-off the project already accepts elsewhere for SQLite-targeted migrations.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_api_keys_selfServiceEmail"`);
  }
}
