CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`a` text NOT NULL,
	`b` text NOT NULL,
	`updated` integer NOT NULL,
	`read_a` integer DEFAULT 0 NOT NULL,
	`read_b` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`a`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`b`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
;
--> statement-breakpoint
CREATE INDEX `conversations_a` ON `conversations` (`a`);;
--> statement-breakpoint
CREATE INDEX `conversations_b` ON `conversations` (`b`);;
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`conversation`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
;
--> statement-breakpoint
CREATE INDEX `messages_conversation` ON `messages` (`conversation`,`created`);;
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL
);
;
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_handle_unique` ON `profiles` (`handle`);;
