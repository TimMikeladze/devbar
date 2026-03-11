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

type PgClient = { end: () => Promise<void> };

type DbGlobalCache = {
	__deloopDb?: DeloopDb | null;
	__deloopDbClose?: DbCloseFn | null;
	__deloopDbPromise?: Promise<DeloopDb> | null;
	__deloopDbDriver?: DbDriver | null;
	__deloopPgClient?: PgClient | null;
	__deloopMigrated?: boolean;
};

const globalCache = globalThis as unknown as DbGlobalCache;

// L1: DB_DRIVER is resolved at module load time. Callers that need to override it
// (e.g. tests) MUST set process.env.DB_DRIVER BEFORE importing this module.
// Use dynamic imports to control ordering.
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
				? (globalCache.__deloopPgClient as ReturnType<typeof postgres> & PgClient)
				: postgres(connectionString);

		globalCache.__deloopDbDriver = "pg";
		globalCache.__deloopPgClient = client;

		_db = drizzle(client, { schema: pgSchema }) as unknown as DeloopDb;

		if (!process.env.SKIP_MIGRATIONS && !globalCache.__deloopMigrated) {
			const { migrate } = await import("drizzle-orm/postgres-js/migrator");
			const { resolve } = await import("node:path");
			await migrate(_db as any, { migrationsFolder: resolve(process.cwd(), "drizzle/pg") });
			globalCache.__deloopMigrated = true;
		}

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

		// Production SQLite performance pragmas + FK enforcement (H2)
		await client.executeMultiple(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA foreign_keys = ON;
    `);

		_db = drizzle(client, { schema: sqliteSchema });

		if (!process.env.SKIP_MIGRATIONS && !globalCache.__deloopMigrated) {
			const { migrate } = await import("drizzle-orm/libsql/migrator");
			const { resolve } = await import("node:path");
			await migrate(_db, { migrationsFolder: resolve(process.cwd(), "drizzle/sqlite") });
			globalCache.__deloopMigrated = true;
		}
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
//
// M1 NOTE: The one semantic difference is the `payload` column — SQLite returns
// a JSON string, PG returns an already-parsed object. All consumers MUST use
// the `parsePayload()` helper in mcp/index.ts (or equivalent) to normalize this.
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

export const apiKeys: typeof sqliteSchema.apiKeys =
	DB_DRIVER === "sqlite"
		? sqliteSchema.apiKeys
		: (pgSchema.apiKeys as unknown as typeof sqliteSchema.apiKeys);

// ============================================
// Schema modules for migrations/advanced use
// ============================================

export { pgSchema, sqliteSchema };

// ============================================
// Types - compatible across both drivers
// ============================================

export type { Comment, NewComment, NewReport, Report } from "./schema.sqlite";
