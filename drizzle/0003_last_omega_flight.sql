CREATE TABLE `merchant_patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `merchants_pattern_unique`;--> statement-breakpoint
ALTER TABLE `merchants` DROP COLUMN `pattern`;--> statement-breakpoint
ALTER TABLE `merchants` DROP COLUMN `match_type`;--> statement-breakpoint
ALTER TABLE `transactions` ADD `ignored` integer DEFAULT 0 NOT NULL;