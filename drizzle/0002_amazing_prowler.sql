CREATE TABLE `merchants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`default_category` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_pattern_unique` ON `merchants` (`pattern`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant_id` integer REFERENCES merchants(id);