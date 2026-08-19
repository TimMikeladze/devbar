import { expect, test, describe } from "bun:test";
import { createPageBus, PageRpcError, type PageDownstream } from "../src/server/page-bus";

function busWithPage(permissions?: { enabled?: boolean; allowMutating?: boolean }) {
	const bus = createPageBus({ sweepIntervalMs: 0, timeoutMs: 50 });
	const page = bus.register({
		url: "http://localhost:3000/pricing",
		title: "Pricing",
		project: "demo",
		permissions: { enabled: true, ...permissions },
	});
	const sent: PageDownstream[] = [];
	bus.attach(page.id, (event) => sent.push(event));
	return { bus, page, sent };
}

describe("page bus", () => {
	test("an rpc reaches the page and its answer resolves the call", async () => {
		const { bus, page, sent } = busWithPage();

		const pending = bus.call(page.id, "inspect", { selector: ".btn" });
		const rpc = sent.find((e) => e.type === "rpc");
		expect(rpc).toBeDefined();
		if (rpc?.type !== "rpc") throw new Error("expected an rpc frame");

		expect(rpc.method).toBe("inspect");
		bus.settle(page.id, rpc.rpcId, { tagName: "BUTTON" });

		expect(await pending).toEqual({ tagName: "BUTTON" });
	});

	test("an error from the page rejects the call with its code", async () => {
		const { bus, page, sent } = busWithPage();
		const pending = bus.call(page.id, "inspect", {});
		const rpc = sent.find((e) => e.type === "rpc");
		if (rpc?.type !== "rpc") throw new Error("expected an rpc frame");

		bus.settle(page.id, rpc.rpcId, undefined, { code: "failed", message: "no match" });
		expect(pending).rejects.toThrow("no match");
	});

	test("a silent page times out instead of hanging", async () => {
		const { bus, page } = busWithPage();
		expect(bus.call(page.id, "inspect", {}, 20)).rejects.toThrow(/in time/);
	});

	test("live tools are refused until the user turns them on", async () => {
		const bus = createPageBus({ sweepIntervalMs: 0 });
		const page = bus.register({ url: "http://localhost:3000" });
		bus.attach(page.id, () => {});

		expect(bus.call(page.id, "inspect", {})).rejects.toThrow(/live tools are off/);

		bus.setPermissions(page.id, { enabled: true });
		// Allowed through now — it only fails because the stub never answers.
		expect(bus.call(page.id, "inspect", {}, 20)).rejects.toThrow(/in time/);
	});

	test("mutating tools need their own opt-in", async () => {
		const { bus, page } = busWithPage({ allowMutating: false });
		expect(bus.call(page.id, "navigate", { url: "http://x" })).rejects.toThrow(/changes the page/);

		bus.setPermissions(page.id, { allowMutating: true });
		const pending = bus.call(page.id, "navigate", { url: "http://x" }, 20);
		expect(pending).rejects.toThrow(/in time/);
		await pending.catch(() => {});
	});

	test("a disconnect rejects everything still in flight", async () => {
		const { bus, page } = busWithPage();
		const pending = bus.call(page.id, "inspect", {});
		bus.disconnect(page.id);

		expect(pending).rejects.toThrow(/disconnected/);
		expect(bus.get(page.id)).toBeUndefined();
	});

	test("stale pages are swept", () => {
		let now = 1000;
		const bus = createPageBus({ sweepIntervalMs: 0, staleAfterMs: 100, now: () => now });
		const page = bus.register({ url: "http://localhost:3000" });

		now = 1050;
		expect(bus.sweep()).toHaveLength(0);

		now = 2000;
		expect(bus.sweep()).toEqual([page.id]);
		expect(bus.list()).toHaveLength(0);
	});

	test("calls to an unknown page fail fast", async () => {
		const bus = createPageBus({ sweepIntervalMs: 0 });
		const err = await bus.call("nope", "inspect", {}).catch((e) => e);
		expect(err).toBeInstanceOf(PageRpcError);
		expect((err as PageRpcError).code).toBe("no_page");
	});
});
