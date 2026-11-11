ALTER TABLE `files` ADD `integrity` text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `checked_at` integer;