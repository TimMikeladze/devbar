// src/server/db/index.ts
// Unified database module that abstracts away pg vs sqlite

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as pgSchema from "./schema.pg";
import * as sqliteSchema from "./schema.sqlite";

/**
 * Database driver type - detected automatically from DATABASE_URL
 */
export type DbDriver = "sqlite" | "pg";

/**
 * Canonical database type used throughout the codebase.
 * We use the SQLite drizzle type as the canonical TypeScript type for both
 * drivers. Both schemas produce structurally identical $inferSelect/$inferInsert
 * types, so this is safe at runtime. Type assertions are contained to this file.
 */
export type DeloopDb = LibSQLDatabase<typeof sqliteSchema>;

type DbCloseFn = () => void | Promise<void>;

type DbGlobalCache = {
	__deloopDb?: DeloopDb | null;
	__deloopDbClose?: DbCloseFn | null;
	__deloopDbPromise?: Promise<DeloopDb> | null;
	__deloopDbDriver?: DbDriver | null;
	__deloopPgClient?: unknown | null;
};

const globalCache = globalThis as unknown as DbGlobalCache;

// Auto-detect driver from DATABASE_URL
function detectDriver(): DbDriver {
	if (process.env.DB_DRIVER) {
		return process.env.DB_DRIVER as DbDriver;
	}

	const dbUrl = process.env.DATABASE_URL;
	if (dbUrl) {
		if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
			return "pg";
		}
	}

	return "sqlite";
}

export const DB_DRIVER: DbDriver = detectDriver();

let _db: DeloopDb | null = null;
let _closeDb: DbCloseFn | null = null;

// If we already initialized in this Node process (e.g. HMR),
// reuse the same db/client rather than creating new connections.
if (globalCache.__deloopDb && globalCache.__deloopDbDriver === DB_DRIVER) {
	_db = globalCache.__deloopDb;
	_closeDb = globalCache.__deloopDbClose ?? null;
}

/**
 * Initialize the database connection based on detected driver
 */
async function initDatabase(): Promise<DeloopDb> {
	if (_db) return _db;
	if (globalCache.__deloopDb && globalCache.__deloopDbDriver === DB_DRIVER) {
		_db = globalCache.__deloopDb;
		_closeDb = globalCache.__deloopDbClose ?? null;
		return _db;
	}

	if (DB_DRIVER === "pg") {
		// PostgreSQL with postgres-js
		const postgres = (await import("postgres")).default;
		const { drizzle } = await import("drizzle-orm/postgres-js");

		const connectionString = process.env.DATABASE_URL;
		if (!connectionString) {
			throw new Error("DATABASE_URL is required for PostgreSQL");
		}

		const client =
			globalCache.__deloopDbDriver === "pg" && globalCache.__deloopPgClient
				? (globalCache.__deloopPgClient as ReturnType<typeof postgres>)
				: postgres(connectionString);

		globalCache.__deloopDbDriver = "pg";
		globalCache.__deloopPgClient = client;

		_db = drizzle(client, { schema: pgSchema }) as unknown as DeloopDb;
		_closeDb = async () => {
			await client.end();
		};
	} else {
		// SQLite with libsql
		const { createClient } = await import("@libsql/client");
		const { drizzle } = await import("drizzle-orm/libsql");

		let databasePath = process.env.DATABASE_URL ?? "file:./deloop.db";
		if (!databasePath.includes("://") && !databasePath.startsWith("file:")) {
			databasePath = `file:${databasePath}`;
		}

		const client = createClient({
			url: databasePath,
			authToken: process.env.TURSO_AUTH_TOKEN,
		});

		// Production SQLite performance pragmas
		await client.executeMultiple(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `);

		// Create tables (SQLite has no migration runner in this setup)
		await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "session" (
        id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "account" (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        access_token TEXT,
        refresh_token TEXT,
        id_token TEXT,
        access_token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        scope TEXT,
        password TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "verification" (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS "organization" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        logo TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "member" (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "invitation" (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        inviter_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS "deloop_reports" (
        id TEXT PRIMARY KEY,
        organization_id TEXT,
        user_id TEXT,
        author_name TEXT,
        author_email TEXT,
        author_avatar TEXT,
        payload TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "deloop_comments" (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        user_id TEXT,
        author_name TEXT,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "deloop_subscriptions" (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL UNIQUE,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT,
        stripe_price_id TEXT,
        plan TEXT NOT NULL DEFAULT 'free',
        status TEXT,
        current_period_end INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

		// Apply indexes
		for (const sql of sqliteSchema.reportIndexes) {
			await client.execute(sql);
		}
		for (const sql of sqliteSchema.commentIndexes) {
			await client.execute(sql);
		}
		for (const sql of sqliteSchema.subscriptionIndexes) {
			await client.execute(sql);
		}

		_db = drizzle(client, { schema: sqliteSchema });
		_closeDb = () => {
			client.close();
		};
	}

	globalCache.__deloopDbDriver = DB_DRIVER;
	globalCache.__deloopDb = _db;
	globalCache.__deloopDbClose = _closeDb;

	return _db!;
}

// Promise for async initialization
let dbPromise: Promise<DeloopDb> | null = null;

function getDbPromise() {
	if (!dbPromise) {
		if (globalCache.__deloopDbPromise && globalCache.__deloopDbDriver === DB_DRIVER) {
			dbPromise = globalCache.__deloopDbPromise;
		} else {
			dbPromise = initDatabase();
			globalCache.__deloopDbPromise = dbPromise;
			globalCache.__deloopDbDriver = DB_DRIVER;
		}
	}
	return dbPromise;
}

/**
 * Get database instance asynchronously
 * This is the primary way to access the database
 */
export async function getDb(): Promise<DeloopDb> {
	return getDbPromise();
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
	if (_closeDb) {
		await _closeDb();
		_db = null;
		dbPromise = null;
		if (globalCache.__deloopDbDriver === DB_DRIVER) {
			globalCache.__deloopDb = null;
			globalCache.__deloopDbClose = null;
			globalCache.__deloopDbPromise = null;
			if (DB_DRIVER === "pg") {
				globalCache.__deloopPgClient = null;
			}
			globalCache.__deloopDbDriver = null;
		}
	}
}

// ============================================
// Table exports - import these directly
// ============================================

// Export tables that work for both drivers.
// When using pg, we assert the pg table to the sqlite table type.
// Both schemas are structurally identical at runtime.
export const reports: typeof sqliteSchema.reports =
	DB_DRIVER === "sqlite"
		? sqliteSchema.reports
		: (pgSchema.reports as unknown as typeof sqliteSchema.reports);

export const comments: typeof sqliteSchema.comments =
	DB_DRIVER === "sqlite"
		? sqliteSchema.comments
		: (pgSchema.comments as unknown as typeof sqliteSchema.comments);

export const subscriptions: typeof sqliteSchema.subscriptions =
	DB_DRIVER === "sqlite"
		? sqliteSchema.subscriptions
		: (pgSchema.subscriptions as unknown as typeof sqliteSchema.subscriptions);

// ============================================
// Schema modules for migrations/advanced use
// ============================================

export { pgSchema, sqliteSchema };

// ============================================
// Types - compatible across both drivers
// ============================================

export type { Comment, NewComment, NewReport, Report } from "./schema.sqlite";
