CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`track_id` integer NOT NULL,
	`title` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `applications_user_id_idx` ON `applications` (`user_id`);--> statement-breakpoint
CREATE INDEX `applications_track_id_archived_idx` ON `applications` (`track_id`,`archived`);--> statement-breakpoint
CREATE TABLE `cell_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`application_id` integer NOT NULL,
	`column_id` integer NOT NULL,
	`value_text` text,
	`value_number` real,
	`value_date` text,
	`value_bool` integer,
	`value_option_id` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `columns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`value_option_id`) REFERENCES `column_options`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cell_values_application_id_column_id_uniq` ON `cell_values` (`application_id`,`column_id`);--> statement-breakpoint
CREATE INDEX `cell_values_column_id_value_text_idx` ON `cell_values` (`column_id`,`value_text`);--> statement-breakpoint
CREATE INDEX `cell_values_column_id_value_number_idx` ON `cell_values` (`column_id`,`value_number`);--> statement-breakpoint
CREATE INDEX `cell_values_column_id_value_date_idx` ON `cell_values` (`column_id`,`value_date`);--> statement-breakpoint
CREATE INDEX `cell_values_column_id_value_option_id_idx` ON `cell_values` (`column_id`,`value_option_id`);--> statement-breakpoint
CREATE TABLE `column_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`column_id` integer NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`buffer_days` integer,
	FOREIGN KEY (`column_id`) REFERENCES `columns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `column_options_user_id_idx` ON `column_options` (`user_id`);--> statement-breakpoint
CREATE INDEX `column_options_column_id_position_idx` ON `column_options` (`column_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `column_options_column_id_label_uniq` ON `column_options` (`column_id`,`label`);--> statement-breakpoint
CREATE TABLE `columns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`track_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`position` integer NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`is_status` integer DEFAULT false NOT NULL,
	`default_value` text,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `columns_user_id_idx` ON `columns` (`user_id`);--> statement-breakpoint
CREATE INDEX `columns_track_id_position_idx` ON `columns` (`track_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `columns_track_id_name_uniq` ON `columns` (`track_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `columns_one_status_per_track_uniq` ON `columns` (`track_id`) WHERE "columns"."is_status" = 1;--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_user_id_key_uniq` ON `settings` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracks_user_id_position_idx` ON `tracks` (`user_id`,`position`);