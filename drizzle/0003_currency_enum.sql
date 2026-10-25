PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`currency` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wallets_balance_non_negative" CHECK("__new_wallets"."balance" >= 0),
	CONSTRAINT "wallets_currency_valid" CHECK("__new_wallets"."currency" IN ('EUR', 'ILS', 'USD')),
	CONSTRAINT "wallets_status_valid" CHECK("__new_wallets"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
INSERT INTO `__new_wallets`("id", "merchant_id", "currency", "balance", "status", "created_at", "updated_at") SELECT "id", "merchant_id", "currency", "balance", "status", "created_at", "updated_at" FROM `wallets`;--> statement-breakpoint
DROP TABLE `wallets`;--> statement-breakpoint
ALTER TABLE `__new_wallets` RENAME TO `wallets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `wallets_merchant_idx` ON `wallets` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`transaction_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_entries_amount_positive" CHECK("__new_ledger_entries"."amount" > 0),
	CONSTRAINT "ledger_entries_currency_valid" CHECK("__new_ledger_entries"."currency" IN ('EUR', 'ILS', 'USD')),
	CONSTRAINT "ledger_entries_type_valid" CHECK("__new_ledger_entries"."type" IN ('CHARGE', 'REFUND'))
);
--> statement-breakpoint
INSERT INTO `__new_ledger_entries`("id", "wallet_id", "transaction_id", "type", "amount", "currency", "timestamp") SELECT "id", "wallet_id", "transaction_id", "type", "amount", "currency", "timestamp" FROM `ledger_entries`;--> statement-breakpoint
DROP TABLE `ledger_entries`;--> statement-breakpoint
ALTER TABLE `__new_ledger_entries` RENAME TO `ledger_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entries_transaction_uq` ON `ledger_entries` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_wallet_idx` ON `ledger_entries` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`merchant_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`decline_reason` text,
	`original_transaction_id` integer,
	`client_request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount_positive" CHECK("__new_transactions"."amount" > 0),
	CONSTRAINT "transactions_currency_valid" CHECK("__new_transactions"."currency" IN ('EUR', 'ILS', 'USD')),
	CONSTRAINT "transactions_type_valid" CHECK("__new_transactions"."type" IN ('CHARGE', 'REFUND')),
	CONSTRAINT "transactions_status_valid" CHECK("__new_transactions"."status" IN ('APPROVED', 'DECLINED')),
	CONSTRAINT "transactions_refund_has_original" CHECK(("__new_transactions"."type" = 'REFUND') = ("__new_transactions"."original_transaction_id" IS NOT NULL)),
	CONSTRAINT "transactions_decline_reason" CHECK(("__new_transactions"."status" = 'DECLINED') = ("__new_transactions"."decline_reason" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "wallet_id", "merchant_id", "type", "amount", "currency", "status", "decline_reason", "original_transaction_id", "client_request_id", "request_hash", "created_at", "updated_at") SELECT "id", "wallet_id", "merchant_id", "type", "amount", "currency", "status", "decline_reason", "original_transaction_id", "client_request_id", "request_hash", "created_at", "updated_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_merchant_client_request_uq` ON `transactions` (`merchant_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_idx` ON `transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_original_idx` ON `transactions` (`original_transaction_id`);--> statement-breakpoint
-- Rebuilding ledger_entries drops its triggers; recreate them (same as 0002).
CREATE TRIGGER `ledger_entries_no_update` BEFORE UPDATE ON `ledger_entries`
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries is append-only: updates are not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_delete` BEFORE DELETE ON `ledger_entries`
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries is append-only: deletes are not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_entries_only_approved` BEFORE INSERT ON `ledger_entries`
WHEN NOT EXISTS (
	SELECT 1 FROM `transactions` t
	WHERE t.`id` = NEW.`transaction_id`
		AND t.`status` = 'APPROVED'
		AND t.`wallet_id` = NEW.`wallet_id`
		AND t.`type` = NEW.`type`
		AND t.`amount` = NEW.`amount`
		AND t.`currency` = NEW.`currency`
)
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries only accepts entries matching an approved transaction');
END;
