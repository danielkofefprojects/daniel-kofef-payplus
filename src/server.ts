import { app } from './app';
import { env } from './config/env';
import { runMigrations } from './db/client';

runMigrations();

app.listen(env.port, () => {
  console.log(`Wallet API listening on http://localhost:${env.port}`);
});
