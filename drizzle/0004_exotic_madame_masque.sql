PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`application_id` integer NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`file_id` integer,
	`submission_id` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "activity_events_kind_check" CHECK("__new_activity_events"."kind" IN ('status_changed', 'file_uploaded', 'submission_created', 'file_deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_activity_events`("id", "user_id", "created_at", "updated_at", "application_id", "kind", "occurred_at", "details", "file_id", "submission_id") SELECT "id", "user_id", "created_at", "updated_at", "application_id", "kind", "occurred_at", "details", "file_id", "submission_id" FROM `activity_events`;--> statement-breakpoint
DROP TABLE `activity_events`;--> statement-breakpoint
ALTER TABLE `__new_activity_events` RENAME TO `activity_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_events_user_id_idx` ON `activity_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `activity_events_application_id_occurred_at_idx` ON `activity_events` (`application_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `activity_events_file_id_idx` ON `activity_events` (`file_id`);--> statement-breakpoint
CREATE INDEX `activity_events_submission_id_idx` ON `activity_events` (`submission_id`);--> statement-breakpoint
ALTER TABLE `files` ADD `deleted_at` integer;