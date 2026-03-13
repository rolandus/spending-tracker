CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`institution` text NOT NULL,
	`type` text NOT NULL,
	`last4` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`posted_date` text,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`transaction_type` text DEFAULT 'unknown' NOT NULL,
	`payment_method` text,
	`check_number` text,
	`cardholder` text,
	`source_category` text,
	`category` text,
	`notes` text,
	`source_file` text NOT NULL,
	`import_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_import_hash_unique` ON `transactions` (`import_hash`);