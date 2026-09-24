import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * A single-use "set / reset password" link emailed to a dashboard user. Same shape and reasoning as
 * SelfServiceKeyRequest: only the token hash is stored, and a consumed row is kept as a record.
 */
@Entity('dashboard_password_resets')
export class DashboardPasswordReset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_dashboard_password_resets_userId')
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Index('IDX_dashboard_password_resets_tokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  createdIp!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
