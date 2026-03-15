ALTER TABLE `merchants` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD `modifies_merchant_id` integer REFERENCES merchants(id);