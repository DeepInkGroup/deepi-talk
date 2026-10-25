CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`conversation` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uploads_owner` ON `uploads` (`owner`);
--> statement-breakpoint
ALTER TABLE `messages` ADD `attachment` text REFERENCES uploads(id);
--> statement-breakpoint
ALTER TABLE `profiles` ADD `avatar` text REFERENCES uploads(id);
--> statement-breakpoint
ALTER TABLE `saved_messages` ADD `attachment` text REFERENCES uploads(id);
