import { sqliteTable, text, integer, real, blob, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// User table
export const users = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(),
  username: text('username').notNull().unique(),
  email: text('email'),
  passwordHash: text('password_hash').notNull(),
  nickname: text('nickname'),
  avatarUrl: text('avatar_url'),
  description: text('description'),
  role: text('role').notNull().default('USER'),
  rowStatus: text('row_status').notNull().default('NORMAL'),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
  updatedTs: integer('updated_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// User settings table
export const userSettings = sqliteTable('user_setting', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  locale: text('locale').notNull().default('zh'),
  appearance: text('appearance').notNull().default('system'),
  memoVisibility: text('memo_visibility').notNull().default('PRIVATE'),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
  updatedTs: integer('updated_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Memo table
export const memos = sqliteTable('memo', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(),
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  visibility: text('visibility').notNull().default('PRIVATE'),
  pinned: integer('pinned').notNull().default(0),
  rowStatus: text('row_status').notNull().default('NORMAL'),
  locationPlaceholder: text('location_placeholder'),
  locationLatitude: real('location_latitude'),
  locationLongitude: real('location_longitude'),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
  updatedTs: integer('updated_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Tag table
export const tags = sqliteTable('tag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Memo-Tag junction table
export const memoTags = sqliteTable('memo_tag', {
  memoId: integer('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.memoId, table.tagId] }),
}));

// Resource table
export const resources = sqliteTable('resource', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(),
  filename: text('filename').notNull(),
  type: text('type').notNull(),
  size: integer('size').notNull(),
  blob: blob('blob'),
  externalLink: text('external_link'),
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
  updatedTs: integer('updated_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Memo-Resource junction table
export const memoResources = sqliteTable('memo_resource', {
  memoId: integer('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  resourceId: integer('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.memoId, table.resourceId] }),
}));

// Memo relation table
export const memoRelations = sqliteTable('memo_relation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memoId: integer('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  relatedMemoId: integer('related_memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('REFERENCE'), // REFERENCE, COMMENT
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Memo reaction table
export const memoReactions = sqliteTable('memo_reaction', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memoId: integer('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reactionType: text('reaction_type').notNull(),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  uniqueReaction: unique('unique_memo_reaction').on(table.memoId, table.creatorId, table.reactionType),
}));

// Workspace setting table
export const workspaceSettings = sqliteTable('workspace_setting', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  settingData: text('setting_data').notNull(), // JSON format
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
  updatedTs: integer('updated_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Shortcut table
export const shortcuts = sqliteTable('shortcut', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  payload: text('payload').notNull(), // JSON format
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdTs: integer('created_ts').notNull().default(sql`(strftime('%s', 'now'))`),
  updatedTs: integer('updated_ts').notNull().default(sql`(strftime('%s', 'now'))`),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  settings: many(userSettings),
  memos: many(memos),
  tags: many(tags),
  resources: many(resources),
  reactions: many(memoReactions),
  shortcuts: many(shortcuts),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const memosRelations = relations(memos, ({ one, many }) => ({
  creator: one(users, {
    fields: [memos.creatorId],
    references: [users.id],
  }),
  tags: many(memoTags),
  resources: many(memoResources),
  relations: many(memoRelations),
  reactions: many(memoReactions),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  creator: one(users, {
    fields: [tags.creatorId],
    references: [users.id],
  }),
  memos: many(memoTags),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  creator: one(users, {
    fields: [resources.creatorId],
    references: [users.id],
  }),
  memos: many(memoResources),
}));

export const memoTagsRelations = relations(memoTags, ({ one }) => ({
  memo: one(memos, {
    fields: [memoTags.memoId],
    references: [memos.id],
  }),
  tag: one(tags, {
    fields: [memoTags.tagId],
    references: [tags.id],
  }),
}));

export const memoResourcesRelations = relations(memoResources, ({ one }) => ({
  memo: one(memos, {
    fields: [memoResources.memoId],
    references: [memos.id],
  }),
  resource: one(resources, {
    fields: [memoResources.resourceId],
    references: [resources.id],
  }),
}));

export const memoRelationsRelations = relations(memoRelations, ({ one }) => ({
  memo: one(memos, {
    fields: [memoRelations.memoId],
    references: [memos.id],
  }),
  relatedMemo: one(memos, {
    fields: [memoRelations.relatedMemoId],
    references: [memos.id],
  }),
}));

export const memoReactionsRelations = relations(memoReactions, ({ one }) => ({
  memo: one(memos, {
    fields: [memoReactions.memoId],
    references: [memos.id],
  }),
  creator: one(users, {
    fields: [memoReactions.creatorId],
    references: [users.id],
  }),
}));

export const shortcutsRelations = relations(shortcuts, ({ one }) => ({
  creator: one(users, {
    fields: [shortcuts.creatorId],
    references: [users.id],
  }),
}));

// Import sql helper
import { sql } from 'drizzle-orm';
import { unique } from 'drizzle-orm/sqlite-core';

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
export type Memo = typeof memos.$inferSelect;
export type NewMemo = typeof memos.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type MemoTag = typeof memoTags.$inferSelect;
export type NewMemoTag = typeof memoTags.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type MemoResource = typeof memoResources.$inferSelect;
export type NewMemoResource = typeof memoResources.$inferInsert;
export type MemoRelation = typeof memoRelations.$inferSelect;
export type NewMemoRelation = typeof memoRelations.$inferInsert;
export type MemoReaction = typeof memoReactions.$inferSelect;
export type NewMemoReaction = typeof memoReactions.$inferInsert;
export type WorkspaceSetting = typeof workspaceSettings.$inferSelect;
export type NewWorkspaceSetting = typeof workspaceSettings.$inferInsert;
export type Shortcut = typeof shortcuts.$inferSelect;
export type NewShortcut = typeof shortcuts.$inferInsert;
