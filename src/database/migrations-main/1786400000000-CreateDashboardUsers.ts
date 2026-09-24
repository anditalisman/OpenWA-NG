import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the dashboard email/password sign-in tables on the **main** connection (always SQLite,
 * see CreateAuthAuditTables1779900000000): `dashboard_users` (accounts, synced from DASHBOARD_USERS),
 * `dashboard_login_sessions` (which ApiKey each login minted) and `dashboard_password_resets`
 * (single-use set/reset password links). Only runs with MAIN_DATABASE_SYNCHRONIZE=false; otherwise
 * TypeORM synchronize creates the same tables from the entities.
 */
export class CreateDashboardUsers1786400000000 implements MigrationInterface {
  name = 'CreateDashboardUsers1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "dashboard_users" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"email" varchar(255) NOT NULL, ` +
        `"passwordHash" varchar(255), ` +
        `"role" varchar(20) NOT NULL DEFAULT ('operator'), ` +
        `"allowedSessions" text, ` +
        `"isActive" boolean NOT NULL DEFAULT (1), ` +
        `"failedLoginCount" integer NOT NULL DEFAULT (0), ` +
        `"lockedUntil" datetime, ` +
        `"lastLoginAt" datetime, ` +
        `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_dashboard_users_email" ON "dashboard_users" ("email")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "dashboard_login_sessions" (` +
        `"apiKeyId" varchar(36) PRIMARY KEY NOT NULL, ` +
        `"userId" varchar(36) NOT NULL, ` +
        `"expiresAt" datetime NOT NULL, ` +
        `"createdIp" varchar(45), ` +
        `"createdAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dashboard_login_sessions_userId" ON "dashboard_login_sessions" ("userId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "dashboard_password_resets" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"userId" varchar(36) NOT NULL, ` +
        `"tokenHash" varchar(64) NOT NULL, ` +
        `"expiresAt" datetime NOT NULL, ` +
        `"consumedAt" datetime, ` +
        `"createdIp" varchar(45), ` +
        `"createdAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_dashboard_password_resets_tokenHash" ON "dashboard_password_resets" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dashboard_password_resets_userId" ON "dashboard_password_resets" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dashboard_password_resets_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dashboard_password_resets_tokenHash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dashboard_password_resets"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dashboard_login_sessions_userId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dashboard_login_sessions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dashboard_users_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dashboard_users"`);
  }
}
