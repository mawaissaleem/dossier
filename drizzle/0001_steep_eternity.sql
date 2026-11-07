CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`application_id` integer NOT NULL,
	`label` text NOT NULL,
	`original_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`relative_path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`upload_date` text NOT NULL,
	`base_name` text NOT NULL,
	`extension` text NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "files_sha256_check" CHECK(length("files"."sha256") = 64 AND "files"."sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "files_size_bytes_check" CHECK("files"."size_bytes" >= 0),
	CONSTRAINT "files_seq_check" CHECK("files"."seq" >= 1)
);
--> statement-breakpoint
CREATE INDEX `files_user_id_idx` ON `files` (`user_id`);--> statement-breakpoint
CREATE INDEX `files_application_id_sha256_idx` ON `files` (`application_id`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_user_id_relative_path_uniq` ON `files` (`user_id`,`relative_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_counter_uniq` ON `files` (`application_id`,`upload_date`,`base_name`,`extension`,`seq`);--> statement-breakpoint
CREATE TABLE `submission_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submission_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `submission_files_user_id_idx` ON `submission_files` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_files_submission_id_file_id_uniq` ON `submission_files` (`submission_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `submission_files_file_id_idx` ON `submission_files` (`file_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`application_id` integer NOT NULL,
	`date` text NOT NULL,
	`note` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submissions_user_id_idx` ON `submissions` (`user_id`);--> statement-breakpoint
CREATE INDEX `submissions_application_id_date_idx` ON `submissions` (`application_id`,`date`);