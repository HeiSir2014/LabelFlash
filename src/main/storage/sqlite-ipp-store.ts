import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type ClientDecisionStore, MAX_REMEMBERED_CLIENTS, type RememberedClient } from '../ipp/client-approvals';
import type { SharePasswordStore, StoredPassword } from '../ipp/share-password';
import { readEnum, readInteger, readString } from './row-readers';

const DECISIONS = ['allow', 'deny'] as const;

/** 局域网共享的两张表：记住的电脑（ipp_clients）、共享密码的摘要（ipp_share_password，只一行）。 */
export class SqliteIppStore implements ClientDecisionStore, SharePasswordStore {
  private readonly selectDecision: StatementSync;
  private readonly upsertDecision: StatementSync;
  private readonly trimDecisions: StatementSync;
  private readonly deleteDecision: StatementSync;
  private readonly selectDecisions: StatementSync;
  private readonly selectPassword: StatementSync;
  private readonly upsertPassword: StatementSync;
  private readonly deletePassword: StatementSync;

  constructor(db: DatabaseSync) {
    this.selectDecision = db.prepare('SELECT decision FROM ipp_clients WHERE address = :address');
    this.upsertDecision = db.prepare(`
      INSERT INTO ipp_clients (address, decision, last_user, decided_at) VALUES (:address, :decision, :lastUser, :decidedAt)
      ON CONFLICT (address) DO UPDATE SET decision = excluded.decision, last_user = excluded.last_user, decided_at = excluded.decided_at`);
    this.trimDecisions = db.prepare(`
      DELETE FROM ipp_clients WHERE address NOT IN (SELECT address FROM ipp_clients ORDER BY decided_at DESC LIMIT :keep)`);
    this.deleteDecision = db.prepare('DELETE FROM ipp_clients WHERE address = :address');
    this.selectDecisions = db.prepare(
      'SELECT address, decision, last_user AS lastUser, decided_at AS decidedAt FROM ipp_clients ORDER BY decided_at DESC',
    );
    this.selectPassword = db.prepare('SELECT salt, hash FROM ipp_share_password WHERE id = 1');
    this.upsertPassword = db.prepare(`
      INSERT INTO ipp_share_password (id, salt, hash, updated_at) VALUES (1, :salt, :hash, :at)
      ON CONFLICT (id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, updated_at = excluded.updated_at`);
    this.deletePassword = db.prepare('DELETE FROM ipp_share_password');
  }

  decisionOf(address: string): 'allow' | 'deny' | null {
    const row = this.selectDecision.get({ address });
    return row === undefined ? null : readEnum(row, 'decision', DECISIONS);
  }

  saveDecision(client: RememberedClient): void {
    this.upsertDecision.run({
      address: client.address,
      decision: client.decision,
      lastUser: client.lastUser,
      decidedAt: client.decidedAt,
    });
    this.trimDecisions.run({ keep: MAX_REMEMBERED_CLIENTS });
  }

  removeDecision(address: string): void {
    this.deleteDecision.run({ address });
  }

  listDecisions(): RememberedClient[] {
    return this.selectDecisions.all().map((row) => ({
      address: readString(row, 'address'),
      decision: readEnum(row, 'decision', DECISIONS),
      lastUser: readString(row, 'lastUser'),
      decidedAt: readInteger(row, 'decidedAt'),
    }));
  }

  /** 读出的行也不全信：盐和摘要必须是字节。 */
  readPassword(): StoredPassword | null {
    const row = this.selectPassword.get();
    if (row === undefined) {
      return null;
    }
    const salt = row['salt'];
    const hash = row['hash'];
    if (!(salt instanceof Uint8Array) || !(hash instanceof Uint8Array)) {
      throw new Error('ipp_share_password has a malformed row');
    }
    return { salt, hash };
  }

  writePassword(password: StoredPassword, at: number): void {
    this.upsertPassword.run({ salt: password.salt, hash: password.hash, at });
  }

  clearPassword(): void {
    this.deletePassword.run();
  }
}
