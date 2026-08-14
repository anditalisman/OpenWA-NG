import { DataSource } from 'typeorm';
import { CreateAuthAuditTables1779900000000 } from '../1779900000000-CreateAuthAuditTables';
import { CreateSelfServiceKeyRequests1786200000000 } from '../1786200000000-CreateSelfServiceKeyRequests';
import { AddSelfServiceRecovery1786300000000 } from '../1786300000000-AddSelfServiceRecovery';

/**
 * Regression lock: the columns the "forgot key" recovery flow reads/writes
 * (ApiKey.selfServiceEmail, SelfServiceKeyRequest.purpose) must exist after running with
 * MAIN_DATABASE_SYNCHRONIZE=false, same reasoning as the two migrations this one builds on.
 */
describe('AddSelfServiceRecovery migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [], synchronize: false });
    await ds.initialize();
    const qr = ds.createQueryRunner();
    await new CreateAuthAuditTables1779900000000().up(qr);
    await new CreateSelfServiceKeyRequests1786200000000().up(qr);
    await qr.release();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('adds api_keys.selfServiceEmail (indexed) and api_key_self_service_requests.purpose (defaulted)', async () => {
    const qr = ds.createQueryRunner();
    await new AddSelfServiceRecovery1786300000000().up(qr);

    const apiKeysColumns = (await qr.query(`PRAGMA table_info("api_keys")`)) as Array<{ name: string }>;
    expect(apiKeysColumns.some(c => c.name === 'selfServiceEmail')).toBe(true);

    const indexes = (await qr.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_keys'",
    )) as Array<{ name: string }>;
    expect(indexes.some(i => i.name === 'IDX_api_keys_selfServiceEmail')).toBe(true);

    const requestColumns = (await qr.query(
      `PRAGMA table_info("api_key_self_service_requests")`,
    )) as Array<{ name: string }>;
    const purposeCol = requestColumns.find(c => c.name === 'purpose');
    expect(purposeCol).toBeDefined();

    // A pre-existing-shape insert (no explicit `purpose`) still works and defaults to 'issue'.
    await qr.query(
      "INSERT INTO api_key_self_service_requests (id, name, email, tokenHash, expiresAt) VALUES ('1', 'n', 'a@b.com', 'hash', '2099-01-01')",
    );
    const rows = (await qr.query(
      "SELECT purpose FROM api_key_self_service_requests WHERE id = '1'",
    )) as Array<{ purpose: string }>;
    expect(rows[0].purpose).toBe('issue');

    await qr.query("INSERT INTO api_keys (id, name, keyHash, keyPrefix, selfServiceEmail) VALUES ('k1', 'n', 'h', 'p', 'a@b.com')");
    const keyRows = (await qr.query(
      "SELECT selfServiceEmail FROM api_keys WHERE id = 'k1'",
    )) as Array<{ selfServiceEmail: string }>;
    expect(keyRows[0].selfServiceEmail).toBe('a@b.com');

    await qr.release();
  });

  it('is idempotent (safe to run on a DB that already has the columns)', async () => {
    const qr = ds.createQueryRunner();
    const migration = new AddSelfServiceRecovery1786300000000();
    await migration.up(qr);
    await expect(migration.up(qr)).resolves.not.toThrow();
    await qr.release();
  });
});
