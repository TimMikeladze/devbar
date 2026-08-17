import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/server/db/schema.sqlite.ts",
	out: "./drizzle/sqlite",
	dialect: "sqlite",
	dbCredentials: { url: process.env.DATABASE_URL ?? "./devbar.db" },
});
