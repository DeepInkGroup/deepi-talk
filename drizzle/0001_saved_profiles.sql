CREATE TABLE `saved_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`source_message` text,
	`source_name` text,
	`created` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `saved_owner_created` ON `saved_messages` (`owner`,`created`);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_owner_source` ON `saved_messages` (`owner`,`source_message`);
--> statement-breakpoint
ALTER TABLE `profiles` ADD `bio` text DEFAULT '' NOT NULL;
