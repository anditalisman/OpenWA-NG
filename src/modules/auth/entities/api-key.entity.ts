import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum ApiKeyRole {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  VIEWER = 'viewer',
}

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  keyHash!: string;

  // 12 to fit the 12-char prefix that auth.service writes (was varchar(8); harmless on the
  // hardcoded-SQLite `main` connection, but kept consistent with the code).
  @Column({ type: 'varchar', length: 12 })
  keyPrefix!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: ApiKeyRole.OPERATOR,
  })
  role!: ApiKeyRole;

  @Column({ type: 'simple-array', nullable: true })
  allowedIps!: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  allowedSessions!: string[] | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  usageCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Transient (non-persisted) resolved session scope, computed once per validation by
   * AuthService.validateApiKey — never read from or written to the database. Deliberately kept
   * separate from `allowedSessions` (the raw, admin-configured column): `allowedSessions` alone still
   * drives @RequireUnscopedKey() (an operator who has already created sessions must still look
   * "unscoped" to create another one) and the last-usable-admin invariant. `effectiveAllowedSessions`
   * is what every session-VISIBILITY check (session-scope.ts, SessionService.findAll/getStats, the
   * webhook/audit/integration-instance/search/agent-tools scoping, EventsGateway subscriptions) should
   * read instead: for an ADMIN key it mirrors `allowedSessions` (null = every session, unchanged
   * behaviour); for a non-admin key with no explicit `allowedSessions`, it resolves to the ids of
   * sessions this same key created (Session.createdByApiKeyId) rather than "every session in the
   * deployment"; a non-admin key with an explicit `allowedSessions` keeps that admin-configured list
   * untouched.
   */
  effectiveAllowedSessions?: string[] | null;
}
