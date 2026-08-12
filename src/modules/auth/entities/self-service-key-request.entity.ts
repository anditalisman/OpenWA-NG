import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * A pending (or already-consumed) self-service API key request: someone submitted their name and a
 * work email, and is waiting to click the emailed verification link. Lives on the 'main' connection,
 * alongside ApiKey/AuditLog — this table has nothing to do with the operator's chosen 'data' backend.
 *
 * The raw verification token is never stored (only its hash) — same reasoning as ApiKey.keyHash: a
 * database leak alone must not hand out a usable token.
 */
@Entity('api_key_self_service_requests')
export class SelfServiceKeyRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  // Set once the link is clicked and a key is issued. A request row is kept (not deleted) after
  // consumption so there is a durable record of who verified, when — the same rationale as never
  // hard-deleting audit rows.
  @Column({ type: 'datetime', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  createdIp!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
