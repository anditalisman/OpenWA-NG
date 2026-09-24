import { DataSource } from 'typeorm';
import { CreateDashboardUsers1786400000000 } from '../1786400000000-CreateDashboardUsers';

/**
 * Regression lock: the main-connection migration must create the dashboard sign-in tables so email
 * + password login works with MAIN_DATABASE_SYNCHRONIZE=false.
 */
describe('CreateDashboardUsers migration', () => {
  const TABLES = ['dashboard_users', 'dashboard_login_sessions', 'dashboard_password_resets'];
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [], synchronize: false });
    await ds.initialize();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const tableNames = async (): Promise<string[]> =>
    (await ds.query<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name);

  it('creates the three tables, with a unique email and a unique reset token', async () => {
    const qr = ds.createQueryRunner();
    await new CreateDashboardUsers1786400000000().up(qr);
    expect(await tableNames()).toEqual(expect.arrayContaining(TABLES));

    await qr.query("INSERT INTO dashboard_users (id, email) VALUES ('1', 'a@b.com')");
    await expect(qr.query("INSERT INTO dashboard_users (id, email) VALUES ('2', 'a@b.com')")).rejects.toThrow();

    await qr.query(
      "INSERT INTO dashboard_password_resets (id, userId, tokenHash, expiresAt) VALUES ('1', '1', 'hash', '2099-01-01')",
    );
    await expect(
      qr.query(
        "INSERT INTO dashboard_password_resets (id, userId, tokenHash, expiresAt) VALUES ('2', '1', 'hash', '2099-01-01')",
      ),
    ).rejects.toThrow();
    await qr.release();
  });

  it('is idempotent', async () => {
    const qr = ds.createQueryRunner();
    const migration = new CreateDashboardUsers1786400000000();
    await migration.up(qr);
    await expect(migration.up(qr)).resolves.not.toThrow();
    await qr.release();
  });

  it('down() drops the tables', async () => {
    const qr = ds.createQueryRunner();
    const migration = new CreateDashboardUsers1786400000000();
    await migration.up(qr);
    await migration.down(qr);
    const names = await tableNames();
    for (const table of TABLES) expect(names).not.toContain(table);
    await qr.release();
  });
});
