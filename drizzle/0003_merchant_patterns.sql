CREATE TABLE `merchant_patterns` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `merchant_id` integer NOT NULL REFERENCES `merchants`(`id`) ON DELETE CASCADE,
  `pattern` text NOT NULL,
  `match_type` text DEFAULT 'contains' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);

-- Migrate existing single patterns into new table
INSERT INTO `merchant_patterns` (`merchant_id`, `pattern`, `match_type`)
SELECT `id`, `pattern`, `match_type` FROM `merchants`;

-- Drop old columns (SQLite 3.35+)
DROP INDEX IF EXISTS `merchants_pattern_unique`;
ALTER TABLE `merchants` DROP COLUMN `pattern`;
ALTER TABLE `merchants` DROP COLUMN `match_type`;
