CREATE TABLE `merchants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "merchants_name_not_empty" CHECK(length(trim("merchants"."name")) > 0),
	CONSTRAINT "merchants_status_valid" CHECK("merchants"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE `transactions` (
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
	CONSTRAINT "transactions_amount_positive" CHECK("transactions"."amount" > 0),
	CONSTRAINT "transactions_type_valid" CHECK("transactions"."type" IN ('CHARGE', 'REFUND')),
	CONSTRAINT "transactions_status_valid" CHECK("transactions"."status" IN ('APPROVED', 'DECLINED')),
	CONSTRAINT "transactions_refund_has_original" CHECK(("transactions"."type" = 'REFUND') = ("transactions"."original_transaction_id" IS NOT NULL)),
	CONSTRAINT "transactions_decline_reason" CHECK(("transactions"."status" = 'DECLINED') = ("transactions"."decline_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_merchant_client_request_uq` ON `transactions` (`merchant_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_idx` ON `transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_original_idx` ON `transactions` (`original_transaction_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`currency` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wallets_balance_non_negative" CHECK("wallets"."balance" >= 0),
	CONSTRAINT "wallets_currency_iso" CHECK(length("wallets"."currency") = 3),
	CONSTRAINT "wallets_status_valid" CHECK("wallets"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE INDEX `wallets_merchant_idx` ON `wallets` (`merchant_id`);