import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * Marks an ApiKey as minted by a dashboard email/password login, and for whom. The dashboard only
 * accepts keys that have a row here (AuthValidateController reports it as `dashboardSession`), which
 * is what stops a plain integration API key from being pasted into the dashboard.
 */
@Entity('dashboard_login_sessions')
export class DashboardLoginSession {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  apiKeyId!: string;

  @Index('IDX_dashboard_login_sessions_userId')
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 45, nullable: true })
  createdIp!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
