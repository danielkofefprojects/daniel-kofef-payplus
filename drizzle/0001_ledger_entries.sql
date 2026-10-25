CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`transaction_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_entries_amount_positive" CHECK("ledger_entries"."amount" > 0),
	CONSTRAINT "ledger_entries_type_valid" CHECK("ledger_entries"."type" IN ('CHARGE', 'REFUND'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entries_transaction_uq` ON `ledger_entries` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_wallet_idx` ON `ledger_entries` (`wallet_id`);