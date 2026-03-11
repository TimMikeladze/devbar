PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deloop_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`user_id` text,
	`author_name` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `deloop_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_deloop_comments`("id", "report_id", "user_id", "author_name", "text", "created_at") SELECT "id", "report_id", "user_id", "author_name", "text", "created_at" FROM `deloop_comments`;--> statement-breakpoint
DROP TABLE `deloop_comments`;--> statement-breakpoint
ALTER TABLE `__new_deloop_comments` RENAME TO `deloop_comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_deloop_comments_report_id` ON `deloop_comments` (`report_id`);