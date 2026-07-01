import { sql } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { users as betterAuthUsers } from "./better-auth.schema"
// No foreign keys — see AGENTS.md

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
        ,
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
            ,
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
            ,
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
 * Provider Accounts — encrypted credentials for model provider routing.
 * Supports multiple accounts per provider; no legacy user_variable fallback.
 */
export const providerAccounts = sqliteTable(
    "provider_account",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull(),
        providerId: text("provider_id").notNull(),
        upstreamId: text("upstream_id"),
        region: text("region"),
        label: text("label"),
        enabled: integer("enabled").notNull().default(1),
        priority: integer("priority"),
        weight: integer("weight"),
        encryptedCredentials: text("encrypted_credentials"),
        configuredCredentials: text("configured_credentials"),
        supportedModelIds: text("supported_model_ids"),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
        updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        providerAccountUserIdx: index("provider_account_user_idx").on(table.userId),
        providerAccountProviderIdx: index("provider_account_provider_idx").on(table.userId, table.providerId, table.upstreamId),
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
 * Assets — generated/uploaded media metadata.
 * Single source of truth per asset. Immutable to user APIs (only system writes).
 *
 * Storage: raw blobs referenced by `srcR2Key` (and `coverR2Key` for video
 * thumbnails). Descriptive metadata (dimensions, duration, byte size, audio
 * waveform peaks, future fields) lives in the JSON `metadata` column — none
 * of it is a query predicate, so collapsing those fields lets us evolve the
 * shape without migrations.
 */
export const assets = sqliteTable(
    "assets",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull(),
        kind: text("kind").notNull(),
        srcR2Key: text("src_r2_key").notNull(),
        coverR2Key: text("cover_r2_key"),
        /** JSON-serialized AssetMetadata (see apps/api-cf/src/services/assets.ts). */
        metadata: text("metadata"),
        sourceModel: text("source_model"),
        sourcePrompt: text("source_prompt"),
        sourceTaskId: text("source_task_id"),
        /**
         * Lineage — JSON-serialized AssetSource[] (see @clash/shared-types/assets).
         * Each entry: { assetId, role: 'edit-source' | 'reference' | 'primary' }.
         * NULL on uploads and pre-lineage rows; populated by edit pipeline (single
         * 'edit-source') and generation pipelines (one per reference image).
         */
        sources: text("sources"),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
        updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        assetsUserIdx: index("assets_user_idx").on(table.userId, table.createdAt),
        assetsTaskIdx: index("assets_task_idx").on(table.sourceTaskId),
    })
)

/**
 * Asset References — M:N junction. One row per (asset, project) pair.
 * Cross-project import = INSERT here; R2 blob shared via assets.srcR2Key.
 * Delete a row when its project no longer references the asset; mark-and-sweep
 * GC reclaims R2 blobs once no asset_refs row points to them.
 */
export const assetRefs = sqliteTable(
    "asset_refs",
    {
        assetId: text("asset_id").notNull(),
        projectId: text("project_id").notNull(),
        importedAt: integer("imported_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.assetId, table.projectId] }),
        assetRefsProjectIdx: index("asset_refs_project_idx").on(table.projectId),
        assetRefsAssetIdx: index("asset_refs_asset_idx").on(table.assetId),
    })
)

/**
 * Runtime — a user's machine running the clash daemon.
 * Keyed by (owner, machine_id) — machine_id is a daemon-computed stable
 * fingerprint so reinstalling on the same box reuses the row instead of
 * accumulating zombies.
 *
 * `agents_json` is the manifest the daemon last reported (PATH-detected
 * ACP agents). `status` is set to 'online' when the WS attaches and
 * back to 'offline' on close or via a sweeper if heartbeat goes stale.
 */
export const runtime = sqliteTable(
    "runtime",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        ownerUserId: text("owner_user_id").notNull(),
        machineId: text("machine_id").notNull(),
        hostname: text("hostname").notNull(),
        os: text("os").notNull(),
        agentsJson: text("agents_json").notNull().default("[]"),
        version: text("version").notNull(),
        status: text("status").notNull().default("offline"),
        lastHeartbeat: integer("last_heartbeat", { mode: "timestamp" }),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        runtimeOwnerIdx: index("runtime_owner_idx").on(table.ownerUserId),
        runtimeUniqueIdx: index("runtime_unique_idx").on(table.ownerUserId, table.machineId),
    })
)

/**
 * Runtime Token — long-lived bearer credential the daemon uses to attach.
 * Token format: `sk_machine_<60-hex>`. Only sha256(token) is stored.
 *
 * `created_by_user_id` separated from runtime.owner_user_id so v2 (org
 * admin issues tokens for shared runtimes) can land without migration.
 */
export const runtimeToken = sqliteTable(
    "runtime_token",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        runtimeId: text("runtime_id").notNull(),
        tokenHash: text("token_hash").notNull(),
        createdByUserId: text("created_by_user_id").notNull(),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
        lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
        revokedAt: integer("revoked_at", { mode: "timestamp" }),
    },
    (table) => ({
        runtimeTokenRuntimeIdx: index("runtime_token_runtime_idx").on(table.runtimeId),
        runtimeTokenHashIdx: index("runtime_token_hash_idx").on(table.tokenHash),
    })
)

/**
 * Connect Daemon Code — short-lived OAuth-style code from `clash setup`.
 * Browser POSTs /connect-daemon (auth'd via session cookie), gets a code,
 * redirects to localhost callback. CLI exchanges code → runtime token.
 * 5-min TTL, single-use.
 */
export const connectDaemonCode = sqliteTable(
    "connect_daemon_code",
    {
        code: text("code").primaryKey(),
        userId: text("user_id").notNull(),
        state: text("state").notNull(),
        expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
        usedAt: integer("used_at", { mode: "timestamp" }),
    },
)

/**
 * Runtime Session — index of agent sessions on user runtimes.
 * Powers resume / history. The actual transcript lives on the user's disk
 * (e.g. ~/.claude/projects/<hash>/<acp_session_id>.jsonl); we just store
 * enough metadata to tell the daemon "load session X next time".
 */
export const runtimeSession = sqliteTable(
    "runtime_session",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull(),
        runtimeId: text("runtime_id").notNull(),
        agentTemplateId: text("agent_template_id").notNull(),
        agentMemberId: text("agent_member_id").notNull(),
        acpSessionId: text("acp_session_id"),
        cwd: text("cwd").notNull(),
        title: text("title"),
        status: text("status").notNull().default("active"),
        createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
        lastActiveAt: integer("last_active_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    },
    (table) => ({
        runtimeSessionUserIdx: index("runtime_session_user_idx").on(table.userId, table.lastActiveAt),
        runtimeSessionRuntimeIdx: index("runtime_session_runtime_idx").on(table.runtimeId),
        runtimeSessionAgentMemberIdx: index("runtime_session_agent_member_idx").on(table.agentMemberId),
    })
)

/**
 * Chat history per local-runtime session.
 *
 * One row per logical message (user prompt or assembled agent turn).
 * Streaming chunks aren't persisted — they're broadcast live via the
 * RuntimeRoom DO and the assembled message gets written on
 * session.complete (events_json holds the raw ACP events; browser
 * uses the same parser as the live stream to render).
 *
 * Why D1 not Loro: chat is append-only, no concurrent-edit case.
 * Cross-session queries (history page, future search) are trivial
 * SQL here vs cross-DO fan-out for Loro.
 */
export const chatMessage = sqliteTable(
    "chat_message",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        sessionId: text("session_id").notNull(),
        userId: text("user_id").notNull(),
        senderKind: text("sender_kind").notNull(), // 'user' | 'agent'
        senderId: text("sender_id").notNull(),     // agent_member_id or user_id
        turnId: text("turn_id"),
        eventsJson: text("events_json").notNull(),
        createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => ({
        chatMessageSessionIdx: index("chat_message_session_idx").on(table.sessionId, table.createdAt),
        chatMessageUserIdx: index("chat_message_user_idx").on(table.userId, table.createdAt),
    })
)

/**
 * Project room — group-chat IM layer.
 *
 * One row per "speech act" — humans typing in the room input or agents
 * broadcasting via the say_to_room tool. Agent internal activity (tool
 * calls, streamed text chunks) does NOT land here — that lives in
 * chat_message scoped to the agent's runtime_session.
 *
 * sender_user_id is on every row (even when sender_kind='agent') so the
 * UI can render "director (alice)". Per-user agent model: each user runs
 * their own daemon; the room is shared across the project's members.
 *
 * mentions_json — array of {user_id, agent_member_id?}. ProjectRoom DO uses it
 * to look up the matching runtime_session and push room.mention into
 * that agent's react loop.
 */
export const roomMessage = sqliteTable(
    "room_message",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        projectId: text("project_id").notNull(),
        senderKind: text("sender_kind").notNull(), // 'user' | 'agent'
        senderId: text("sender_id").notNull(),     // user_id (when 'user') or agent_member_id (when 'agent')
        senderUserId: text("sender_user_id").notNull(),
        mentionsJson: text("mentions_json").notNull(),
        text: text("text").notNull(),
        createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => ({
        roomMessageProjectIdx: index("room_message_project_idx").on(table.projectId, table.createdAt),
    })
)

/**
 * Claimed agent members — concrete instances of bundled agent templates.
 *
 * Templates (Director / Canvas Editor / …) ship in the bridge daemon
 * as read-only role definitions. A user "claims" a template + runtime
 * to create one of these rows — e.g. "Alice's Director on alice-mac".
 *
 * Once claimed, the row is what gets invited into project rooms, what
 * room mentions target, and what spawns sessions.
 *
 * Display name defaults to template label; user can rename to
 * distinguish multiple instances of the same template.
 */
export const agentMember = sqliteTable(
    "agent_member",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull(),
        templateId: text("template_id").notNull(),
        runtimeId: text("runtime_id").notNull(),
        // ACP CLI to spawn (claude-agent-acp / codex / gemini / …).
        agentId: text("agent_id").notNull(),
        displayName: text("display_name").notNull(),
        createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
        // ── Per-agent budget (Phase 0 multi-actor billing) ───────
        // Set in Settings → Agent budgets; read by the (closed-source)
        // billing plugin at generation time. Platform code only plumbs.
        // budgetCredits = NULL means "no cap" (unlimited).
        budgetCredits: integer("budget_credits"),
        // 'monthly' | 'one-time' | 'unlimited'. Plugin owns the reset
        // semantics; we just store the user's choice.
        budgetPeriod: text("budget_period").default("monthly"),
        budgetUsed: integer("budget_used").default(0),
        budgetResetAt: integer("budget_reset_at"),
    },
    (table) => ({
        agentMemberUserIdx: index("agent_member_user_idx").on(table.userId, table.createdAt),
        agentMemberRuntimeIdx: index("agent_member_runtime_idx").on(table.runtimeId),
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
