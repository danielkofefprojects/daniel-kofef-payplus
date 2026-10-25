import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Each test file gets its own throwaway SQLite file. This must run before src/db/client
// is imported, because the client opens the database as soon as it is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payplus-test-'));
process.env.DB_FILE = path.join(dir, 'test.db');

const { runMigrations } = await import('../src/db/client');
runMigrations();

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
