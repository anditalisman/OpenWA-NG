import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `api_key_self_service_requests` on the **main** connection (always SQLite, see
 * CreateAuthAuditTables1779900000000). Backs the self-service "request an API key by verified email"
 * flow: a row is created on request, and consumed (consumedAt set, never deleted) once the emailed
 * link is clicked and a real ApiKey is issued.
 */
export class CreateSelfServiceKeyRequests1786200000000 implements MigrationInterface {
  name = 'CreateSelfServiceKeyRequests1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "api_key_self_service_requests" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"name" varchar(100) NOT NULL, ` +
        `"email" varchar(255) NOT NULL, ` +
        `"tokenHash" varchar(64) NOT NULL, ` +
        `"expiresAt" datetime NOT NULL, ` +
        `"consumedAt" datetime, ` +
        `"createdIp" varchar(45), ` +
        `"createdAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_self_service_requests_tokenHash" ON "api_key_self_service_requests" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_self_service_requests_email" ON "api_key_self_service_requests" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_self_service_requests_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_self_service_requests_tokenHash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_key_self_service_requests"`);
  }
}
