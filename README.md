# PayPlus Wallet API

Node.js + TypeScript + Express 5, SQLite via Drizzle ORM (better-sqlite3).

## Run from a fresh clone

Prerequisites: Node.js 22+ and npm (`better-sqlite3` is a native module, so the install needs a working build toolchain if no prebuilt binary matches your platform).

```bash
git clone https://github.com/danielkofefprojects/daniel-kofef-payplus.git
cd daniel-kofef-payplus
npm install
cp .env.example .env     # PORT (default 3000) and DB_FILE (default ./data/wallet.db)
npm run dev              # starts on http://localhost:3000, migrations run automatically on startup
```

Check it is up:

```bash
curl http://localhost:3000/api/health     # {"status":"ok"}
```

The SQLite file is created on first start (the `data/` folder is made for you). Delete it to reset all data.

Other scripts:

```bash
npm test                 # unit + integration tests
npm run typecheck
npm run build && npm start   # compiled production run (dist/)
```

For example requests, see the curl quick start in [docs/API.md](docs/API.md).

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

## Request logging

`src/middlewares/requestLogger.ts` is a small hand-written Express middleware. For each request it:

- assigns an `X-Request-Id` (the client's value if sent, otherwise a UUID) and returns it as a response header;
- logs one JSON line when the response finishes: time, request id, method, path, status and duration;
- includes the request and response bodies, with keys that look sensitive (password, token, card, etc.) replaced by `[REDACTED]` and the text capped at 2000 characters;
- writes with `console.log`, or `console.error` for 5xx responses.

It is a minimal tool and not very helpful beyond basic debugging: there are no log levels or configuration, redaction is a regex guess on key names (anything not matching is logged, which is risky for a payments API), bodies are captured by monkey-patching `res.json`, and output can't be shipped anywhere except stdout.

**Recommendation: replace it with [pino](https://github.com/pinojs/pino) + [pino-http](https://github.com/pinojs/pino-http).** It is a mature, fast, widely used logger that gives us log levels (`LOG_LEVEL`), built-in path-based redaction (e.g. `Authorization` and `Cookie` headers), request-id generation, per-level status mapping (4xx as `warn`, 5xx as `error`), child loggers, and a transport ecosystem (`pino-pretty` for local dev, shipping to log platforms in production). We would also stop logging request and response bodies by default. This is not implemented yet.

## Business assumptions

- **A wallet has one currency, fixed at creation** (`ILS`, `USD` or `EUR`). A transaction must use the wallet's currency; there is no conversion, so a mismatch is declined (`CURRENCY_MISMATCH`).
- **Wallets start with a balance of 0**, and the balance changes only through approved transactions. There is no deposit or withdrawal endpoint.
- **A charge credits the merchant's wallet** (a customer pays the merchant) and **a refund debits it**. The balance can never go below zero.
- **A refund refers to one approved charge** of the same wallet and currency. **Partial and multiple refunds are allowed**, as long as the running total of approved refunds never exceeds the original charge amount (otherwise `REFUND_EXCEEDS_ORIGINAL`).
- **Merchants and wallets are never deleted**, only set to `INACTIVE`. An inactive merchant or wallet declines new transactions, but its history stays readable.
- **Validation before moving money:**
  - Unknown merchant, wallet or original transaction → `404`, nothing stored.
  - Inactive merchant or wallet → declined.
  - Wallet of another merchant → declined (`WALLET_MERCHANT_MISMATCH`).
  - Currency differs from the wallet's → declined (`CURRENCY_MISMATCH`).
  - Insufficient balance (refund) → declined.
  - Refund of a non-approved charge, or above the original amount → declined.
  - Malformed input (bad amount, unsupported currency, missing `Idempotency-Key`) → `400`.
- **A wallet belongs to the merchant that created it.** A transaction naming a wallet of another merchant is declined (`WALLET_MERCHANT_MISMATCH`).
- **Every approved transaction produces exactly one ledger entry**; declined transactions produce none. Ledger entries are immutable.
- **No authentication or authorization.** Any caller can act for any merchant; in production the merchant would be derived from the caller's credentials instead of the request body.
- **No fees, taxes or per-transaction limits.**

## Money and idempotency

- Amounts are **integers in minor units** (agorot/cents): `1000` = 10.00 ILS.
- `charge` and `refund` need an `Idempotency-Key` header (stored as `client_request_id`, unique per merchant).
  - Same key + same body → the original transaction is returned (`200`, `Idempotent-Replayed: true`); money is not moved again.
  - Same key + different body → `409`.
- **Convention:** a request that is well-formed and refers to existing records, but breaks a business rule, is saved as a `DECLINED` transaction (so it is auditable and replayable).
  Malformed requests (`400`), unknown wallet / merchant / transaction (`404`) and idempotency-key reuse with a different body (`409`) are plain errors and store nothing.
- Business-rule failures (inactive wallet or merchant, insufficient funds, currency mismatch, refund over the original amount,
  refunding something that isn't an approved charge)
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
GET   /transactions           (paginated)      GET /transactions/:id
GET   /ledger                 (paginated, append-only)
```

## Pagination

`GET /transactions` and `GET /ledger` use **offset pagination** (`page` + `limit`, response includes `total` and `totalPages`).
That is fine at this data volume: it is simple, supports jumping to any page, and the cost of `OFFSET` is negligible.

For a much larger volume we would switch to **cursor (keyset) pagination** (`?after=<last id>`, ordered by an indexed unique key):

- `OFFSET n` makes the database scan and discard `n` rows, so deep pages get slower and slower; a cursor seeks straight to the position via the index.
- Offset pages can skip or repeat rows when new rows are inserted between requests; a cursor is stable.
- The trade-offs: no random page access and no cheap `total` (the `COUNT(*)` we run per request would be dropped).
