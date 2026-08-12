import { DataSource } from 'typeorm';
import { CreateSelfServiceKeyRequests1786200000000 } from '../1786200000000-CreateSelfServiceKeyRequests';

/**
 * Regression lock: the main-connection migration must create the
 * api_key_self_service_requests table so the self-service key flow works with
 * MAIN_DATABASE_SYNCHRONIZE=false.
 */
describe('CreateSelfServiceKeyRequests migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [], synchronize: false });
    await ds.initialize();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates api_key_self_service_requests with a unique tokenHash index', async () => {
    const qr = ds.createQueryRunner();
    await new CreateSelfServiceKeyRequests1786200000000().up(qr);

    const tables = (await qr.query("SELECT name FROM sqlite_master WHERE type='table'")) as Array<{ name: string }>;
    expect(tables.map(t => t.name)).toContain('api_key_self_service_requests');

    const indexes = (await qr.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_key_self_service_requests'",
    )) as Array<{ name: string }>;
    expect(indexes.some(i => i.name === 'IDX_self_service_requests_tokenHash')).toBe(true);
    expect(indexes.some(i => i.name === 'IDX_self_service_requests_email')).toBe(true);

    await qr.query(
      "INSERT INTO api_key_self_service_requests (id, name, email, tokenHash, expiresAt) VALUES ('1', 'n', 'a@b.com', 'hash', '2099-01-01')",
    );
    // The unique index rejects a second row with the same tokenHash.
    await expect(
      qr.query(
        "INSERT INTO api_key_self_service_requests (id, name, email, tokenHash, expiresAt) VALUES ('2', 'n2', 'c@d.com', 'hash', '2099-01-01')",
      ),
    ).rejects.toThrow();

    await qr.release();
  });

  it('is idempotent (safe to run on a DB that already has the table)', async () => {
    const qr = ds.createQueryRunner();
    const migration = new CreateSelfServiceKeyRequests1786200000000();
    await migration.up(qr);
    await expect(migration.up(qr)).resolves.not.toThrow();
    await qr.release();
  });

  it('down() drops the table', async () => {
    const qr = ds.createQueryRunner();
    const migration = new CreateSelfServiceKeyRequests1786200000000();
    await migration.up(qr);
    await migration.down(qr);
    const tables = (await qr.query("SELECT name FROM sqlite_master WHERE type='table'")) as Array<{ name: string }>;
    expect(tables.map(t => t.name)).not.toContain('api_key_self_service_requests');
    await qr.release();
  });
});
