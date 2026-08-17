import { describe, test, expect, beforeAll } from "bun:test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const TEST_DB_PATH = resolve(tmpdir(), `devbar-flags-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.DB_DRIVER = "sqlite";
process.env.BETTER_AUTH_SECRET = "flag-gating-test-secret-000000000000000000";

const { getServerFlags } = await import("../src/server/flags");
const { createDevbarServer } = await import("../src/server/index");

/** Build a server with an explicit flag environment. */
async function serverWith(env: Record<string, string | undefined>) {
	const previous = {
		DEVBAR_FLAG_PAID_PLANS: process.env.DEVBAR_FLAG_PAID_PLANS,
		DEVBAR_FLAG_CONTACT_FORM: process.env.DEVBAR_FLAG_CONTACT_FORM,
	};
	Object.assign(process.env, env);
	try {
		const { app } = await createDevbarServer();
		return app;
	} finally {
		Object.assign(process.env, previous);
	}
}

describe("getServerFlags", () => {
	test("everything is off by default", () => {
		expect(getServerFlags({})).toEqual({ paidPlans: false, contactForm: false });
	});

	test('accepts "true" and "1" only', () => {
		expect(getServerFlags({ DEVBAR_FLAG_PAID_PLANS: "true" }).paidPlans).toBe(true);
		expect(getServerFlags({ DEVBAR_FLAG_PAID_PLANS: "1" }).paidPlans).toBe(true);
		for (const value of ["false", "0", "yes", "", "TRUE"]) {
			expect(getServerFlags({ DEVBAR_FLAG_PAID_PLANS: value }).paidPlans).toBe(false);
		}
	});
});

/**
 * Assert against the router table rather than response codes: every `/api/*`
 * path is covered by the auth middleware, so an unmounted route answers 401
 * rather than 404 and the two cases are indistinguishable from outside.
 */
function paths(app: { routes: { method: string; path: string }[] }): string[] {
	return [...new Set(app.routes.map((r) => r.path))];
}

describe("route gating", () => {
	let off: Awaited<ReturnType<typeof serverWith>>;

	beforeAll(async () => {
		off = await serverWith({
			DEVBAR_FLAG_PAID_PLANS: undefined,
			DEVBAR_FLAG_CONTACT_FORM: undefined,
		});
	});

	test("paid and contact routes are absent by default", () => {
		expect(paths(off).filter((p) => p.includes("stripe"))).toEqual([]);
		expect(paths(off).filter((p) => p.includes("contact"))).toEqual([]);
	});

	test("unflagged routes stay reachable", async () => {
		const res = await off.request("/health");
		expect(res.status).toBe(200);
	});

	test("paid routes mount when the flag is on", async () => {
		const on = await serverWith({ DEVBAR_FLAG_PAID_PLANS: "true" });
		const stripe = paths(on).filter((p) => p.includes("stripe"));
		expect(stripe).toContain("/api/stripe/checkout");
		expect(stripe).toContain("/api/stripe/webhook");
		// Mounted behind auth, so an anonymous call is rejected rather than served.
		const res = await on.request("/api/stripe/checkout", { method: "POST" });
		expect(res.status).toBe(401);
	});

	test("contact route mounts when the flag is on", async () => {
		const on = await serverWith({ DEVBAR_FLAG_CONTACT_FORM: "true" });
		expect(paths(on)).toContain("/api/contact");
		const res = await on.request("/api/contact", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "a@b.c", message: "hi" }),
		});
		// No DISCORD_WEBHOOK_URL in tests — the handler answering at all is the point.
		expect(res.status).toBe(500);
	});
});
