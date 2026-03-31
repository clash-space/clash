import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { users as betterAuthUsers } from "./better-auth.schema"

/**
 * Projects table - stores basic project metadata
 * Canvas data (nodes/edges) is managed by Loro Sync Server in Durable Objects
 */
export const projects = sqliteTable("project", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    ownerId: text("owner_id")
        .notNull()
        .references(() => betterAuthUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
})

/**
 * API Tokens — enables CLI and external agent access.
 * Token format: clsh_ + 40 hex chars. Only SHA-256 hash is stored.
 */
export const apiTokens = sqliteTable(
    "api_token",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => betterAuthUsers.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        tokenHash: text("token_hash").notNull(),
        tokenPrefix: text("token_prefix").notNull(),
        lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        apiTokenUserIdIdx: index("api_token_userId_idx").on(table.userId),
        apiTokenHashIdx: index("api_token_hash_idx").on(table.tokenHash),
    })
)

/**
 * User Variables — encrypted key-value store for API keys used by actions.
 * Values are AES-GCM encrypted with ACTION_SECRET_KEY env var.
 * Actions declare required variables in their manifest (secrets[]).
 * Platform decrypts and injects at runtime.
 */
export const userVariables = sqliteTable(
    "user_variable",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => betterAuthUsers.id, { onDelete: "cascade" }),
        key: text("key").notNull(),
        encryptedValue: text("encrypted_value").notNull(),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
        updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        userVariableUserIdx: index("user_variable_userId_idx").on(table.userId),
        userVariableUniqueIdx: index("user_variable_unique_idx").on(table.userId, table.key),
    })
)

/**
 * Installed Actions — globally installed canvas actions per user.
 * Actions appear in all project toolbars.
 */
export const installedActions = sqliteTable(
    "installed_action",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => betterAuthUsers.id, { onDelete: "cascade" }),
        actionId: text("action_id").notNull(),
        name: text("name").notNull(),
        description: text("description"),
        manifest: text("manifest").notNull(),
        runtime: text("runtime").notNull().default("worker"),
        version: text("version"),
        author: text("author"),
        repository: text("repository"),
        workerUrl: text("worker_url"),
        icon: text("icon"),
        color: text("color"),
        tags: text("tags"),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        installedActionUserIdx: index("installed_action_userId_idx").on(table.userId),
        installedActionUniqueIdx: index("installed_action_unique_idx").on(table.userId, table.actionId),
    })
)

/**
 * Installed Skills — globally installed AI agent skills per user.
 * Skills are SKILL.md instruction sets for Claude Code.
 */
export const installedSkills = sqliteTable(
    "installed_skill",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => betterAuthUsers.id, { onDelete: "cascade" }),
        skillId: text("skill_id").notNull(),
        name: text("name").notNull(),
        description: text("description"),
        repository: text("repository"),
        version: text("version"),
        author: text("author"),
        icon: text("icon"),
        tags: text("tags"),
        linkedActionId: text("linked_action_id"),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        installedSkillUserIdx: index("installed_skill_userId_idx").on(table.userId),
        installedSkillUniqueIdx: index("installed_skill_unique_idx").on(table.userId, table.skillId),
    })
)
