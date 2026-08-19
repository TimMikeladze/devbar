import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { AgentPreset } from "./presets";
import type { AgentEvent, AgentRunner, RunContext } from "./types";

/**
 * Runs an agent CLI as a child process and turns its output into events.
 *
 * The prompt goes over stdin wherever the CLI allows it. That is not a style
 * preference: an argv-delivered prompt dies with E2BIG once it passes ~1 MB,
 * and node throws that *synchronously* from spawn(), where a child "error"
 * handler never sees it.
 */

export type CliRunnerOptions = {
	preset: AgentPreset;
	/** Overrides the preset's argv entirely. Placeholders are substituted. */
	argsOverride?: string[];
	/** Grace period between SIGTERM and SIGKILL when cancelled. */
	killGraceMs?: number;
};

const PLACEHOLDERS = /\{(model|effort|permission|prompt|promptFile|dir|session)\}/g;

function substitute(args: string[], ctx: RunContext): string[] {
	return args.map((arg) =>
		arg.replace(PLACEHOLDERS, (_, key: string) => {
			switch (key) {
				case "model":
					return ctx.model ?? "";
				case "effort":
					return ctx.effort ?? "";
				case "permission":
					return ctx.permissionMode ?? ctx.permission;
				case "prompt":
					return ctx.prompt;
				case "promptFile":
					return ctx.promptFile ?? "";
				case "dir":
					return ctx.cwd;
				case "session":
					return ctx.sessionId ?? ctx.newSessionId ?? "";
				default:
					return "";
			}
		}),
	);
}

/** Split a stream into whole lines, holding the trailing partial one. */
function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
	let buffer = "";
	return (chunk: string) => {
		buffer += chunk;
		let index = buffer.indexOf("\n");
		while (index >= 0) {
			onLine(buffer.slice(0, index));
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf("\n");
		}
	};
}

export function createCliRunner(options: CliRunnerOptions): AgentRunner {
	const { preset, killGraceMs = 5000 } = options;

	return async function* run(ctx: RunContext): AsyncIterable<AgentEvent> {
		const built = options.argsOverride
			? { args: substitute(options.argsOverride, ctx), warnings: [] }
			: preset.buildArgs(ctx);

		const args = [...built.args];
		if (preset.prompt === "arg") args.push(ctx.prompt);
		else if (preset.prompt === "file" && ctx.promptFile) args.push(ctx.promptFile);

		const cwd = existsSync(ctx.cwd) ? ctx.cwd : undefined;
		const command = preset.command;

		for (const warning of built.warnings) {
			yield { type: "stdout", text: `[devbar] ${warning}\n` };
		}
		yield { type: "start", command: `${command} ${args.join(" ")}`, cwd: cwd ?? process.cwd() };

		const queue: AgentEvent[] = [];
		let notify: (() => void) | undefined;
		let finished = false;

		function push(event: AgentEvent): void {
			queue.push(event);
			notify?.();
		}

		function handleLine(line: string): void {
			const trimmed = line.trim();
			if (!trimmed) return;
			if (preset.parseEvent && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
				try {
					const parsed = preset.parseEvent(JSON.parse(trimmed));
					if (parsed.length > 0) {
						for (const event of parsed) push(event);
						return;
					}
					// Parsed fine but told us nothing — drop it rather than dumping JSON.
					return;
				} catch {
					// Not JSON after all; fall through to raw text.
				}
			}
			push({ type: "stdout", text: `${line}\n` });
		}

		let child: ReturnType<typeof spawn>;
		try {
			// Windows has no /usr/bin/env, and agent CLIs install there as .cmd
			// shims node refuses to spawn without a shell. Args stay an array so
			// node quotes them instead of us building a command line.
			child =
				process.platform === "win32"
					? spawn(command, args, {
							cwd,
							stdio: ["pipe", "pipe", "pipe"],
							shell: true,
							windowsHide: true,
							env: { ...process.env, ...ctx.env },
						})
					: spawn("/usr/bin/env", [command, ...args], {
							cwd,
							stdio: ["pipe", "pipe", "pipe"],
							env: { ...process.env, ...ctx.env },
						});
		} catch (err) {
			// spawn() throws synchronously for E2BIG and a bad cwd — the child
			// "error" event is never emitted for these.
			yield { type: "error", message: String(err) };
			yield { type: "done", exitCode: 1 };
			return;
		}

		const onStdout = createLineSplitter(handleLine);
		const onStderr = createLineSplitter((line) => push({ type: "stdout", text: `${line}\n` }));
		child.stdout?.on("data", (data: Buffer) => onStdout(data.toString()));
		child.stderr?.on("data", (data: Buffer) => onStderr(data.toString()));

		if (preset.prompt === "stdin") {
			child.stdin?.on("error", () => {});
			child.stdin?.end(ctx.prompt);
		} else {
			child.stdin?.end();
		}

		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const onAbort = (): void => {
			push({ type: "error", message: "cancelled" });
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
		};
		ctx.signal.addEventListener("abort", onAbort, { once: true });

		child.on("error", (err) => {
			push({ type: "error", message: String(err) });
		});
		child.on("close", (code) => {
			finished = true;
			push({ type: "done", exitCode: code ?? 1 });
		});

		try {
			while (true) {
				if (queue.length === 0) {
					if (finished) break;
					await new Promise<void>((resolve) => {
						notify = resolve;
					});
					notify = undefined;
					continue;
				}
				const event = queue.shift() as AgentEvent;
				yield event;
				// "done" from the preset parser (claude's result line) is informational;
				// only the process close event ends the stream.
				if (event.type === "done" && finished && queue.length === 0) break;
			}
		} finally {
			clearTimeout(killTimer);
			ctx.signal.removeEventListener("abort", onAbort);
		}
	};
}
