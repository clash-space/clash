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
