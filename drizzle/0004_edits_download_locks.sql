ALTER TABLE `messages` ADD `edited_at` integer;
--> statement-breakpoint
ALTER TABLE `saved_messages` ADD `edited_at` integer;
--> statement-breakpoint
ALTER TABLE `uploads` ADD `download_locked` integer DEFAULT 0 NOT NULL;
