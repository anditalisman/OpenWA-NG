import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiKeyRole } from './api-key.entity';

/**
 * A person allowed to sign in to the dashboard with email + password. Lives on the 'main'
 * connection next to ApiKey. The account list itself comes from the DASHBOARD_USERS env var (see
 * DashboardAuthService.syncUsersFromEnv) — this table only adds what the env cannot hold: the
 * password hash, lockout counters and login history.
 *
 * Signing in never hands out a stored API key (only key hashes are kept, so none could be handed
 * back): each login mints a fresh, short-lived key carrying this user's role and allowedSessions,
 * tracked in DashboardLoginSession.
 */
@Entity('dashboard_users')
export class DashboardUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_dashboard_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  // scrypt hash (see dashboard-password.ts); null until the user sets a password through the
  // emailed reset link, so a freshly provisioned account cannot be signed in to by anyone.
  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 20, default: ApiKeyRole.OPERATOR })
  role!: ApiKeyRole;

  // Copied onto every key this user's logins mint. Null = every session, which is only honoured
  // for ADMIN (a non-admin key with no allowlist sees only sessions it created itself, i.e. none).
  @Column({ type: 'simple-array', nullable: true })
  allowedSessions!: string[] | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  failedLoginCount!: number;

  @Column({ type: 'datetime', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
