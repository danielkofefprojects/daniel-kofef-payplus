PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- This trigger reads `transactions`; SQLite validates triggers on RENAME, so drop it while the table is rebuilt.
DROP TRIGGER `ledger_entries_only_approved`;--> statement-breakpoint
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
	CONSTRAINT "transactions_decline_reason" CHECK(("__new_transactions"."status" = 'DECLINED') = ("__new_transactions"."decline_reason" IS NOT NULL)),
	CONSTRAINT "transactions_decline_reason_valid" CHECK("__new_transactions"."decline_reason" IS NULL OR "__new_transactions"."decline_reason" IN ('WALLET_INACTIVE', 'MERCHANT_INACTIVE', 'INSUFFICIENT_FUNDS', 'CURRENCY_MISMATCH', 'REFUND_EXCEEDS_ORIGINAL', 'ORIGINAL_NOT_REFUNDABLE', 'WALLET_MERCHANT_MISMATCH'))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "wallet_id", "merchant_id", "type", "amount", "currency", "status", "decline_reason", "original_transaction_id", "client_request_id", "request_hash", "created_at", "updated_at") SELECT "id", "wallet_id", "merchant_id", "type", "amount", "currency", "status", "decline_reason", "original_transaction_id", "client_request_id", "request_hash", "created_at", "updated_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_merchant_client_request_uq` ON `transactions` (`merchant_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_idx` ON `transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_original_idx` ON `transactions` (`original_transaction_id`);--> statement-breakpoint
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
