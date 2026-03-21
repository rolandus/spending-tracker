ALTER TABLE `merchant_patterns` ADD `default_category` text;--> statement-breakpoint
ALTER TABLE `merchant_patterns` ADD `default_transaction_type` text;--> statement-breakpoint
UPDATE `merchant_patterns` SET `default_category` = (
  SELECT `default_category` FROM `merchants` WHERE `merchants`.`id` = `merchant_patterns`.`merchant_id`
);--> statement-breakpoint
ALTER TABLE `merchants` DROP COLUMN `default_category`;
