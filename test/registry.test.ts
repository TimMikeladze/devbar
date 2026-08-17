import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createRegistry, type ProjectConfig } from "../src/server/registry";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpPath(): string {
	return join(tmpdir(), `devbar-test-${randomUUID()}.json`);
}

describe("registry", () => {
	let filePath: string;

	beforeEach(() => {
		filePath = tmpPath();
	});

	afterEach(async () => {
		await rm(filePath, { force: true });
	});

	test("register and get a project", async () => {
		const reg = await createRegistry(filePath);
		const config: ProjectConfig = {
			slug: "app-a",
			dir: "/tmp/app-a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		};
		await reg.register(config);
		expect(reg.get("app-a")).toEqual(config);
	});

	test("list returns all projects", async () => {
		const reg = await createRegistry(filePath);
		await reg.register({
			slug: "a",
			dir: "/a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		});
		await reg.register({
			slug: "b",
			dir: "/b",
			model: "opus",
			effort: "high",
			concurrency: 2,
			permissionMode: "auto",
			autoDispatch: false,
		});
		const list = reg.list();
		expect(list).toHaveLength(2);
		expect(list.map((p) => p.slug).sort()).toEqual(["a", "b"]);
	});

	test("unregister removes a project", async () => {
		const reg = await createRegistry(filePath);
		await reg.register({
			slug: "a",
			dir: "/a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		});
		await reg.unregister("a");
		expect(reg.get("a")).toBeUndefined();
	});

	test("persists to disk and reloads", async () => {
		const reg1 = await createRegistry(filePath);
		await reg1.register({
			slug: "app",
			dir: "/app",
			model: "haiku",
			effort: "low",
			concurrency: 3,
			permissionMode: "default",
			autoDispatch: true,
		});

		const reg2 = await createRegistry(filePath);
		expect(reg2.get("app")).toEqual({
			slug: "app",
			dir: "/app",
			model: "haiku",
			effort: "low",
			concurrency: 3,
			permissionMode: "default",
			autoDispatch: true,
		});
	});

	test("register overwrites existing project", async () => {
		const reg = await createRegistry(filePath);
		await reg.register({
			slug: "a",
			dir: "/a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		});
		await reg.register({
			slug: "a",
			dir: "/a-new",
			model: "opus",
			effort: "high",
			concurrency: 2,
			permissionMode: "auto",
			autoDispatch: false,
		});
		expect(reg.get("a")?.dir).toBe("/a-new");
		expect(reg.get("a")?.model).toBe("opus");
	});

	test("get returns undefined for unknown slug", async () => {
		const reg = await createRegistry(filePath);
		expect(reg.get("nope")).toBeUndefined();
	});
});
