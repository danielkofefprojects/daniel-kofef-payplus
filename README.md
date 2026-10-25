# PayPlus Wallet API

Node.js + TypeScript + Express 5, SQLite via Drizzle ORM (better-sqlite3).

## Run

```bash
npm install
cp .env.example .env
npm run dev          # migrations run automatically on startup
```

## Structure

```
src/
  config/        env vars
  db/            schema (tables) + client (connection, migrations)
  routes/        URL -> middleware -> controller
  controllers/   read the request, call a service, send the response
  services/      business logic (balances, transactions)
  middlewares/   validation, idempotency key, error handling
  validators/    zod request schemas (strict: unknown fields are rejected)
  utils/         errors, hashing
drizzle/         generated SQL migrations
```

After changing `src/db/schema.ts`, run `npm run db:generate` to create a new migration.

## Money and idempotency

- Amounts are **integers in minor units** (agorot/cents): `1000` = 10.00 ILS.
- `charge` and `refund` need an `Idempotency-Key` header (stored as `client_request_id`, unique per merchant).
  - Same key + same body → the original transaction is returned (`200`, `Idempotent-Replayed: true`); money is not moved again.
  - Same key + different body → `409`.
- Business-rule failures (inactive wallet or merchant, insufficient funds, currency mismatch, refund over the original amount)
  and a wallet that doesn't belong to the merchant are saved as `DECLINED` transactions with a `declineReason`, and move no money.
  They return `422` with the reason as the error `code` (retries return the same `422`).
- The idempotency check, balance change and transaction row are written in **one DB transaction**.
- Balances can't go negative: the debit is a single conditional `UPDATE`, backed by a `CHECK (balance >= 0)` constraint.

## Endpoints (`/api`)

Full payloads, rules and error codes: **[docs/API.md](docs/API.md)**

```
POST  /merchants              GET /merchants        GET /merchants/:id     PATCH /merchants/:id/status
POST  /wallets                GET /wallets          GET /wallets/:id       PATCH /wallets/:id/status
POST  /transactions/charge    POST /transactions/refund
GET   /transactions           GET /transactions/:id
GET   /ledger                 (paginated, append-only)
```
