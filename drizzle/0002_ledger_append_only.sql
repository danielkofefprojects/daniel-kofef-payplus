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
