import { betterAuth } from "better-auth";
import type { Auth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DeloopDb } from "./db";
import { DB_DRIVER, pgSchema, sqliteSchema } from "./db";

export function createAuth(db: DeloopDb): Auth {
  const schema = DB_DRIVER === "pg" ? pgSchema : sqliteSchema;
  return betterAuth({
    database: drizzleAdapter(db as any, {
      provider: DB_DRIVER === "pg" ? "pg" : "sqlite",
      schema: schema as any,
    }),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      ...(process.env.BETTER_AUTH_GITHUB_CLIENT_ID &&
      process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: process.env.BETTER_AUTH_GITHUB_CLIENT_ID,
              clientSecret: process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(process.env.BETTER_AUTH_GOOGLE_CLIENT_ID &&
      process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.BETTER_AUTH_GOOGLE_CLIENT_ID,
              clientSecret: process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        membershipLimit: 100,
      }),
    ],
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.DELOOP_TRUSTED_ORIGINS?.split(",").map((s) =>
      s.trim(),
    ) ?? ["*"],
  }) as unknown as Auth;
}

export type DeloopAuth = ReturnType<typeof createAuth>;
