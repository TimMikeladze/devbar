import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SQLiteTableWithColumns, SQLiteColumn } from "drizzle-orm/sqlite-core";

type ReportsTable = SQLiteTableWithColumns<{
	name: "deloop_reports";
	schema: undefined;
	columns: {
		id: SQLiteColumn<
			{
				name: "id";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: true;
				hasDefault: true;
				isPrimaryKey: true;
				isAutoincrement: false;
				hasRuntimeDefault: true;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		organizationId: SQLiteColumn<
			{
				name: "organization_id";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		userId: SQLiteColumn<
			{
				name: "user_id";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		authorName: SQLiteColumn<
			{
				name: "author_name";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		authorEmail: SQLiteColumn<
			{
				name: "author_email";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		authorAvatar: SQLiteColumn<
			{
				name: "author_avatar";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		payload: SQLiteColumn<
			{
				name: "payload";
				tableName: "deloop_reports";
				dataType: "json";
				columnType: "SQLiteTextJson";
				data: unknown;
				driverParam: string;
				notNull: true;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: undefined;
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{}
		>;
		url: SQLiteColumn<
			{
				name: "url";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: true;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		title: SQLiteColumn<
			{
				name: "title";
				tableName: "deloop_reports";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: true;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		createdAt: SQLiteColumn<
			{
				name: "created_at";
				tableName: "deloop_reports";
				dataType: "date";
				columnType: "SQLiteTimestamp";
				data: Date;
				driverParam: number;
				notNull: true;
				hasDefault: true;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: true;
				enumValues: undefined;
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{}
		>;
	};
	dialect: "sqlite";
}>;

type CommentsTable = SQLiteTableWithColumns<{
	name: "deloop_comments";
	schema: undefined;
	columns: {
		id: SQLiteColumn<
			{
				name: "id";
				tableName: "deloop_comments";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: true;
				hasDefault: true;
				isPrimaryKey: true;
				isAutoincrement: false;
				hasRuntimeDefault: true;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		reportId: SQLiteColumn<
			{
				name: "report_id";
				tableName: "deloop_comments";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: true;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		userId: SQLiteColumn<
			{
				name: "user_id";
				tableName: "deloop_comments";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		authorName: SQLiteColumn<
			{
				name: "author_name";
				tableName: "deloop_comments";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: false;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		text: SQLiteColumn<
			{
				name: "text";
				tableName: "deloop_comments";
				dataType: "string";
				columnType: "SQLiteText";
				data: string;
				driverParam: string;
				notNull: true;
				hasDefault: false;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: false;
				enumValues: [string, ...string[]];
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{ length: number }
		>;
		createdAt: SQLiteColumn<
			{
				name: "created_at";
				tableName: "deloop_comments";
				dataType: "date";
				columnType: "SQLiteTimestamp";
				data: Date;
				driverParam: number;
				notNull: true;
				hasDefault: true;
				isPrimaryKey: false;
				isAutoincrement: false;
				hasRuntimeDefault: true;
				enumValues: undefined;
				baseColumn: never;
				identity: undefined;
				generated: undefined;
			},
			{},
			{}
		>;
	};
	dialect: "sqlite";
}>;

// ============================================
// Better Auth tables
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth internal tables
export const user: any = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const session: any = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		activeOrganizationId: text("active_organization_id"),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account: any = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification: any = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ============================================
// Better Auth organization tables
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth internal tables
export const organization: any = sqliteTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	logo: text("logo"),
	metadata: text("metadata"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth internal tables
export const member: any = sqliteTable("member", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	role: text("role").notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth internal tables
export const invitation: any = sqliteTable("invitation", {
	id: text("id").primaryKey(),
	email: text("email").notNull(),
	inviterId: text("inviter_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	role: text("role").notNull(),
	status: text("status").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ============================================
// Deloop tables
// ============================================

/**
 * Reports table - stores feedback reports with full payload
 */
export const reports: ReportsTable = sqliteTable(
	"deloop_reports",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/** FK to organization */
		organizationId: text("organization_id"),

		/** FK to better-auth users, nullable */
		userId: text("user_id"),

		/** Author name for injected identity */
		authorName: text("author_name"),

		/** Author email for injected identity */
		authorEmail: text("author_email"),

		/** Author avatar URL */
		authorAvatar: text("author_avatar"),

		/** Full DeloopPayload as JSON */
		payload: text("payload", { mode: "json" }).notNull(),

		/** Page URL, denormalized for filtering */
		url: text("url").notNull(),

		/** Page title, denormalized */
		title: text("title").notNull(),

		/** When the report was created */
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [
		index("idx_deloop_reports_org_id").on(table.organizationId),
		index("idx_deloop_reports_user_id").on(table.userId),
		index("idx_deloop_reports_url").on(table.url),
		index("idx_deloop_reports_created_at").on(table.createdAt),
	],
) as ReportsTable;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

/**
 * Comments table - threaded comments on reports
 */
export const comments: CommentsTable = sqliteTable(
	"deloop_comments",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/** FK to reports — matches PG schema's .references() for consistency (H2) */
		reportId: text("report_id")
			.notNull()
			.references(() => reports.id, { onDelete: "cascade" }),

		/** FK to better-auth users, nullable */
		userId: text("user_id"),

		/** Author name */
		authorName: text("author_name"),

		/** Comment text */
		text: text("text").notNull(),

		/** When the report was created */
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [index("idx_deloop_comments_report_id").on(table.reportId)],
) as CommentsTable;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

/**
 * Subscriptions table - tracks Stripe subscription per organization
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stripe subscription tracking
export const subscriptions: any = sqliteTable(
	"deloop_subscriptions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text("organization_id").notNull().unique(),
		stripeCustomerId: text("stripe_customer_id").notNull(),
		stripeSubscriptionId: text("stripe_subscription_id"),
		stripePriceId: text("stripe_price_id"),
		plan: text("plan").notNull().default("free"),
		status: text("status"),
		currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [index("idx_deloop_subscriptions_stripe_customer").on(table.stripeCustomerId)],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

// ============================================
// API Keys table (for MCP server auth)
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP API key table
export const apiKeys: any = sqliteTable(
	"deloop_api_keys",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text("organization_id").notNull(),
		// H1: .unique() creates an implicit index used by resolveAuthContext() lookups.
		// No separate named index needed — the UNIQUE constraint handles it.
		key: text("key")
			.notNull()
			.unique()
			.$defaultFn(() => `dlp_${crypto.randomUUID().replace(/-/g, "")}`),
		label: text("label"),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [index("idx_deloop_api_keys_org_id").on(table.organizationId)],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
