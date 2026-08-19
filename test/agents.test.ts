import { expect, test, describe } from "bun:test";
import { PRESETS, resolvePreset, resolveRunner } from "../src/server/agents";
import type { RunContext } from "../src/server/agents";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
	return {
		prompt: "fix the button",
		cwd: "/repo",
		permission: "plan",
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("agent presets", () => {
	test("claude gets the flags it actually has", () => {
		const { args } = (PRESETS.claude as NonNullable<typeof PRESETS.claude>).buildArgs(
			ctx({ model: "sonnet", effort: "high", maxBudgetUsd: 5 }),
		);
		expect(args).toContain("--print");
		expect(args).toContain("--output-format");
		expect(args).toContain("stream-json");
		expect(args.join(" ")).toContain("--model sonnet");
		expect(args.join(" ")).toContain("--effort high");
		expect(args.join(" ")).toContain("--permission-mode plan");
		expect(args.join(" ")).toContain("--max-budget-usd 5");
	});

	test("claude assigns a session id up front, and resumes by id later", () => {
		const claude = PRESETS.claude as NonNullable<typeof PRESETS.claude>;
		const fresh = claude.buildArgs(ctx({ newSessionId: "abc" }));
		expect(fresh.args.join(" ")).toContain("--session-id abc");

		const resumed = claude.buildArgs(ctx({ sessionId: "abc", newSessionId: "def" }));
		expect(resumed.args.join(" ")).toContain("--resume abc");
		expect(resumed.args.join(" ")).not.toContain("--session-id");
	});

	test("codex drops knobs it does not have instead of failing the run", () => {
		const { args, warnings } = (PRESETS.codex as NonNullable<typeof PRESETS.codex>).buildArgs(
			ctx({ model: "gpt-5", effort: "high", maxBudgetUsd: 5 }),
		);
		expect(args.join(" ")).not.toContain("--effort");
		expect(args.join(" ")).not.toContain("budget");
		expect(warnings.join(" ")).toContain("effort");
		expect(warnings.join(" ")).toContain("maxBudgetUsd");
	});

	test("codex resume is a different argv shape, not a flag", () => {
		const codex = PRESETS.codex as NonNullable<typeof PRESETS.codex>;
		expect(codex.buildArgs(ctx()).args.slice(0, 1)).toEqual(["exec"]);
		expect(codex.buildArgs(ctx({ sessionId: "s1" })).args.slice(0, 3)).toEqual([
			"exec",
			"resume",
			"s1",
		]);
	});

	test("permission levels map onto each CLI's own vocabulary", () => {
		const claude = PRESETS.claude as NonNullable<typeof PRESETS.claude>;
		const codex = PRESETS.codex as NonNullable<typeof PRESETS.codex>;

		expect(claude.buildArgs(ctx({ permission: "auto" })).args.join(" ")).toContain(
			"--permission-mode acceptEdits",
		);
		expect(codex.buildArgs(ctx({ permission: "plan" })).args.join(" ")).toContain("-s read-only");
		expect(codex.buildArgs(ctx({ permission: "auto" })).args.join(" ")).toContain(
			"-s workspace-write",
		);
		expect(codex.buildArgs(ctx({ permission: "full" })).args.join(" ")).toContain(
			"--dangerously-bypass-approvals-and-sandbox",
		);
	});

	test("opencode takes the prompt as argv and warns that it has no read-only mode", () => {
		const opencode = PRESETS.opencode as NonNullable<typeof PRESETS.opencode>;
		expect(opencode.prompt).toBe("arg");

		const plan = opencode.buildArgs(ctx({ permission: "plan" }));
		expect(plan.warnings.join(" ")).toContain("no read-only mode");
		expect(plan.args).not.toContain("--auto");

		const auto = opencode.buildArgs(ctx({ permission: "auto" }));
		expect(auto.args).toContain("--auto");
	});

	test("an unknown command runs bare rather than borrowing claude's flags", () => {
		const preset = resolvePreset("my-agent");
		expect(preset.command).toBe("my-agent");
		expect(preset.buildArgs(ctx({ model: "sonnet" })).args).toEqual([]);
		expect(preset.capabilities.model).toBe(false);

		const resolved = resolveRunner({ command: "my-agent" });
		expect(resolved.warnings.join(" ")).toContain("no preset");
	});
});

describe("claude event parsing", () => {
	const claude = PRESETS.claude as NonNullable<typeof PRESETS.claude>;

	test("reads text, tool calls, session id and cost out of stream-json", () => {
		const parse = claude.parseEvent as NonNullable<typeof claude.parseEvent>;

		expect(parse({ type: "system", subtype: "init", session_id: "s1" })).toEqual([
			{ type: "session", sessionId: "s1" },
		]);

		expect(
			parse({
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "looking" },
						{ type: "tool_use", name: "Edit" },
					],
				},
			}),
		).toEqual([
			{ type: "stdout", text: "looking\n" },
			{ type: "tool", name: "Edit" },
		]);

		const result = parse({ type: "result", total_cost_usd: 0.12, result: "done" });
		expect(result).toContainEqual({ type: "done", exitCode: 0, costUsd: 0.12 });
	});
});

describe("cli runner", () => {
	test("streams a real process to completion", async () => {
		const { runner } = resolveRunner({ command: "echo" });
		const events = [];
		for await (const event of runner(ctx({ prompt: "hello" }))) events.push(event);

		expect(events[0]?.type).toBe("start");
		expect(events.at(-1)).toEqual({ type: "done", exitCode: 0 });
	});

	test("a missing binary fails the run instead of throwing", async () => {
		const { runner } = resolveRunner({ command: "devbar-not-a-real-binary" });
		const events = [];
		for await (const event of runner(ctx())) events.push(event);

		const done = events.at(-1);
		expect(done?.type).toBe("done");
		expect(done?.type === "done" && done.exitCode).not.toBe(0);
	});

	test("cancelling ends the stream", async () => {
		const controller = new AbortController();
		const { runner } = resolveRunner({ command: "sleep", args: ["10"] });

		const events = [];
		setTimeout(() => controller.abort(), 50);
		for await (const event of runner(ctx({ signal: controller.signal }))) events.push(event);

		expect(events.some((e) => e.type === "error" && e.message === "cancelled")).toBe(true);
		expect(events.at(-1)?.type).toBe("done");
	});
});
