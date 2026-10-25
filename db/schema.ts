import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  bio: text('bio').notNull().default(''),
});
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  a: text('a').notNull().references(() => profiles.id),
  b: text('b').notNull().references(() => profiles.id),
  updated: integer('updated').notNull(),
  readA: integer('read_a').notNull().default(0),
  readB: integer('read_b').notNull().default(0),
}, table => [index('conversations_a').on(table.a), index('conversations_b').on(table.b)]);
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversation: text('conversation').notNull().references(() => conversations.id),
  sender: text('sender').notNull().references(() => profiles.id),
  body: text('body').notNull(),
  created: integer('created').notNull(),
}, table => [index('messages_conversation').on(table.conversation, table.created)]);
export const savedMessages = sqliteTable('saved_messages', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull().references(() => profiles.id),
  body: text('body').notNull(),
  sourceMessage: text('source_message'),
  sourceName: text('source_name'),
  created: integer('created').notNull(),
}, table => [index('saved_owner_created').on(table.owner, table.created), uniqueIndex('saved_owner_source').on(table.owner, table.sourceMessage)]);
