import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env } from '../config/env';
import * as schema from './schema';

fs.mkdirSync(path.dirname(env.dbFile), { recursive: true });

const sqlite = new Database(env.dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export function runMigrations() {
  // Table-rebuild migrations (drop + rename) need FK enforcement off, and the
  // pragma is a no-op inside a transaction, so toggle it around the migrator.
  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
    const violations = sqlite.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(`Foreign key violations after migration: ${JSON.stringify(violations)}`);
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}
