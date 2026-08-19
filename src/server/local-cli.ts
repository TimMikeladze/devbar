#!/usr/bin/env node
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { DevbarConfig } from "../config";
import { createLocalServer } from "./local";
import { loadConfig } from "./config-loader";
import { createLocalClient, findLocalServer, readStoredToken } from "./local-client";
import { PRESETS } from "./agents";
import type { ProjectConfig } from "./registry";

/** Replaced with the package version at build time (see bunup.config.ts). */
declare const DEVBAR_VERSION: string;

const DEVBAR_DIR = join(homedir(), ".devbar");
const TOKEN_PATH = join(DEVBAR_DIR, "token");

async function loadOrCreateToken(): Promise<string> {
	try {
		const existing = await readFile(TOKEN_PATH, "utf-8");
		const trimmed = existing.trim();
		if (trimmed) return trimmed;
	} catch {}

	await mkdir(DEVBAR_DIR, { recursive: true });
	const token = randomUUID();
	// 0600: this token authorizes running an agent in your repositories.
	await writeFile(TOKEN_PATH, token, { encoding: "utf-8", mode: 0o600 });
	return token;
}

type CliArgs = {
	port: number;
	host: string;
	token?: string;
	name?: string;
	model: string;
	effort: string;
	concurrency: number;
	maxBudget?: number;
	permission: string;
	permissionMode?: string;
	command?: string;
	server?: string;
	timeoutMs?: number;
	autoDispatch: boolean;
	watch: boolean;
	all: boolean;
	project?: string;
	positional: string[];
};

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		port: 3100,
		host: "127.0.0.1",
		model: "sonnet",
		effort: "medium",
		concurrency: 1,
		permission: "plan",
		autoDispatch: true,
		watch: false,
		all: false,
		positional: [],
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const next = argv[i + 1] as string;

		switch (flag) {
			case "--port":
			case "-p":
				args.port = Number.parseInt(next, 10);
				i++;
				break;
			case "--host":
				args.host = next;
				i++;
				break;
			case "--token":
			case "-t":
				args.token = next;
				i++;
				break;
			case "--name":
				args.name = next;
				i++;
				break;
			case "--model":
				args.model = next;
				i++;
				break;
			case "--effort":
				args.effort = next;
				i++;
				break;
			case "--agent":
			case "--command":
				args.command = next;
				i++;
				break;
			case "--concurrency":
				args.concurrency = Number.parseInt(next, 10);
				i++;
				break;
			case "--max-budget":
				args.maxBudget = Number.parseFloat(next);
				i++;
				break;
			case "--permission":
				args.permission = next;
				i++;
				break;
			case "--permission-mode":
				args.permissionMode = next;
				i++;
				break;
			case "--timeout":
				args.timeoutMs = Number.parseInt(next, 10) * 1000;
				i++;
				break;
			case "--project":
				args.project = next;
				i++;
				break;
			case "--server":
				args.server = next;
				i++;
				break;
			case "--no-auto":
				args.autoDispatch = false;
				break;
			case "--watch":
			case "-w":
				args.watch = true;
				break;
			case "--all":
				args.all = true;
				break;
			default:
				if (flag && !flag.startsWith("-")) args.positional.push(flag);
				break;
		}
	}

	return args;
}

function buildProjectConfig(args: CliArgs): ProjectConfig {
	const cwd = process.cwd();
	return {
		slug: args.name ?? basename(cwd),
		dir: cwd,
		model: args.model,
		effort: args.effort,
		maxBudgetUsd: args.maxBudget,
		concurrency: args.concurrency,
		permission: args.permission as ProjectConfig["permission"],
		permissionMode: args.permissionMode,
		command: args.command,
		timeoutMs: args.timeoutMs,
		autoDispatch: args.autoDispatch,
	};
}

/**
 * Merge a project-root devbar.config.ts over the flag-derived config.
 * Config-file values take precedence over CLI flag defaults; `dir` is always
 * the current directory (where the config lives).
 */
export function applyConfig(base: ProjectConfig, file: DevbarConfig | undefined): ProjectConfig {
	if (!file) return base;
	const agent = file.agent ?? {};
	return {
		...base,
		...(file.project ? { slug: file.project } : {}),
		...(file.origins ? { origins: file.origins } : {}),
		...(file.live ? { live: file.live } : {}),
		...(agent.command ? { command: agent.command } : {}),
		...(agent.args ? { args: agent.args } : {}),
		...(agent.runner ? { runner: agent.runner } : {}),
		...(agent.model ? { model: agent.model } : {}),
		...(agent.effort ? { effort: agent.effort } : {}),
		...(agent.concurrency !== undefined ? { concurrency: agent.concurrency } : {}),
		...(agent.permission ? { permission: agent.permission } : {}),
		...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
		...(agent.autoDispatch !== undefined ? { autoDispatch: agent.autoDispatch } : {}),
		...(agent.maxBudgetUsd !== undefined ? { maxBudgetUsd: agent.maxBudgetUsd } : {}),
		...(agent.timeoutMs !== undefined ? { timeoutMs: agent.timeoutMs } : {}),
		...(agent.resumeSession !== undefined ? { resumeSession: agent.resumeSession } : {}),
		...(file.routes ? { routes: file.routes } : {}),
	};
}

async function isServerRunning(host: string, port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://${host === "::" ? "127.0.0.1" : host}:${port}/health`);
		const data = await res.json();
		return data.ok === true;
	} catch {
		return false;
	}
}

async function registerWithExistingServer(
	host: string,
	port: number,
	token: string,
	config: ProjectConfig,
): Promise<void> {
	const res = await fetch(`http://${host === "::" ? "127.0.0.1" : host}:${port}/api/projects`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(config),
	});

	if (!res.ok) {
		const data = await res.json();
		throw new Error(`Failed to register: ${data.error ?? res.statusText}`);
	}
}

const HELP = `devbar — local dispatch server and agent bridge

Usage
  devbar [command] [options]

Commands
  (none)               Start the server, or register this project with a running one
  mcp                  Run the MCP server on stdio (for Claude Code, codex, opencode)
  doctor               Check that everything needed to dispatch is in place
  tasks [--watch]      List dispatch tasks
  reports              List captured reports
  dispatch [id|--all]  Dispatch a report, or every pending one
  init                 Write a starter devbar.config.ts
  link                 Print the toolbar snippet for this project

Options
  -p, --port <n>            Port to listen on (default: 3100)
      --host <host>         Host to bind (default: 127.0.0.1 — loopback only)
  -t, --token <token>       Auth token (default: DEVBAR_TOKEN, or ~/.devbar/token)
      --name <slug>         Project slug (default: current directory name)
      --agent <name>        Agent command: claude, codex, opencode, or any binary
      --model <model>       Agent model (default: sonnet)
      --effort <level>      Agent reasoning effort (default: medium)
      --permission <level>  plan | auto | full (default: plan)
      --permission-mode <m> Raw per-CLI permission string
      --concurrency <n>     Concurrent agent tasks (default: 1)
      --max-budget <usd>    Spend ceiling per project
      --timeout <seconds>   Hard stop for one run (default: 600)
      --project <slug>      Filter for tasks/reports/dispatch
      --server <url>        Talk to a server at this URL (default: probe 3100/3101)
      --no-auto             Do not dispatch reports automatically
  -h, --help                Show this help
  -v, --version             Show the version
`;

const CONFIG_TEMPLATE = `import { defineConfig } from "devbar/config";

export default defineConfig({
	// Pages on these origins are matched to this project automatically,
	// so <Devbar /> needs no server/token/project props.
	origins: ["http://localhost:3000"],

	agent: {
		command: "claude", // "claude" | "codex" | "opencode" | any binary on PATH
		model: "sonnet",
		// plan = read-only, auto = may edit the workspace, full = no sandbox
		permission: "plan",
		// Reports only run an agent once you turn this on.
		autoDispatch: false,
	},

	live: {
		// Lets an agent inspect and screenshot the page you have open.
		enabled: true,
		allowMutating: false,
	},
});
`;

async function commandInit(): Promise<void> {
	const path = join(process.cwd(), "devbar.config.ts");
	try {
		await access(path);
		console.log(`devbar.config.ts already exists at ${path}`);
		return;
	} catch {}
	await writeFile(path, CONFIG_TEMPLATE, "utf-8");
	console.log(`wrote ${path}`);
}

async function commandDoctor(args: CliArgs): Promise<void> {
	const lines: string[] = [];
	let problems = 0;

	function check(ok: boolean, label: string, detail?: string): void {
		if (!ok) problems++;
		lines.push(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
	}

	const url = await findLocalServer(clientOptions(args));
	check(!!url, "server running", url ?? "start one with `devbar`");

	const config = await loadConfig(process.cwd());
	check(!!config, "devbar.config.ts found", config ? undefined : "run `devbar init`");

	const project = applyConfig(buildProjectConfig(args), config);
	check(
		!!project.origins?.length,
		"origins configured",
		project.origins?.join(", ") ?? "add origins so pages match without props",
	);

	const command = project.command ?? "claude";
	const onPath = await which(command);
	check(!!onPath, `agent "${command}" on PATH`, onPath ?? "install it, or set agent.command");
	if (!PRESETS[command]) {
		lines.push(`  note: no preset for "${command}" — it runs bare, without flags or event parsing`);
	}

	if (url) {
		try {
			const client = await createLocalClient({ url });
			const hello = await client.hello();
			const registered = hello.projects.some((p) => p.slug === project.slug);
			check(
				registered,
				`project "${project.slug}" registered`,
				registered ? undefined : "run `devbar` here",
			);
			const pages = await client.listPages();
			lines.push(`  connected pages: ${pages.length}`);
			const reports = await client.listReports();
			const pending = reports.filter((r) => r.status === "new").length;
			lines.push(`  reports: ${reports.length} (${pending} unworked)`);
		} catch (err) {
			check(false, "server responded", String(err));
		}
	}

	const token = await readStoredToken();
	check(!!token, "token readable", token ? "~/.devbar/token" : "will be created on first run");

	console.log(lines.join("\n"));
	console.log(problems === 0 ? "\nall good" : `\n${problems} problem(s)`);
	if (problems > 0) process.exitCode = 1;
}

async function which(command: string): Promise<string | undefined> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		const finder = process.platform === "win32" ? "where" : "which";
		const child = spawn(finder, [command], { stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		child.stdout?.on("data", (d: Buffer) => {
			out += d.toString();
		});
		child.on("error", () => resolve(undefined));
		child.on("close", (code) => resolve(code === 0 ? out.trim().split("\n")[0] : undefined));
	});
}

function formatAge(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	return `${Math.round(m / 60)}h ago`;
}

/** The CLI's own --port/--server should win over the default probe order. */
function clientOptions(args: CliArgs): { url?: string; token?: string; ports: number[] } {
	return {
		url: args.server,
		token: args.token,
		ports: [...new Set([args.port, 3100, 3101])],
	};
}

async function commandTasks(args: CliArgs): Promise<void> {
	const client = await createLocalClient(clientOptions(args));

	async function render(): Promise<void> {
		const tasks = await client.listTasks({ project: args.project });
		if (tasks.length === 0) {
			console.log("no tasks");
			return;
		}
		for (const task of tasks.slice(-20)) {
			const age = formatAge(Date.now() - task.createdAt);
			const cost = task.result?.costUsd ? ` $${task.result.costUsd.toFixed(2)}` : "";
			console.log(
				`${task.id.slice(0, 8)}  ${task.status.padEnd(9)} ${task.projectSlug.padEnd(16)} ${age}${cost}`,
			);
		}
	}

	await render();
	if (!args.watch) return;

	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		console.log("—".repeat(48));
		await render();
	}
}

async function commandReports(args: CliArgs): Promise<void> {
	const client = await createLocalClient(clientOptions(args));
	const reports = await client.listReports({ project: args.project });
	if (reports.length === 0) {
		console.log("no reports");
		return;
	}
	for (const report of reports.slice(0, 30)) {
		console.log(
			`${report.id}  ${report.status.padEnd(10)} ${(report.project ?? "-").padEnd(16)} ` +
				`${report.assets.length} asset(s)  ${formatAge(Date.now() - report.createdAt)}`,
		);
	}
}

async function commandDispatch(args: CliArgs): Promise<void> {
	const client = await createLocalClient(clientOptions(args));
	const target = args.positional[1];
	const tasks = target
		? await client.dispatch({ report: target })
		: await client.dispatch({ project: args.project });
	console.log(tasks.length === 0 ? "nothing to dispatch" : `dispatched ${tasks.length} task(s)`);
	for (const id of tasks) console.log(`  ${id}`);
}

async function commandLink(args: CliArgs): Promise<void> {
	const config = await loadConfig(process.cwd());
	const project = applyConfig(buildProjectConfig(args), config);
	console.log(`Mount the toolbar — no props needed when the page runs on one of:`);
	console.log(`  ${project.origins?.join(", ") ?? "(no origins configured — run `devbar init`)"}`);
	console.log("");
	console.log('  import { Devbar } from "devbar";');
	console.log("  <Devbar />");
	console.log("");
	console.log("For a page on another origin, wire it explicitly:");
	console.log(
		`  <Devbar server="http://127.0.0.1:${args.port}" project="${project.slug}" token={process.env.DEVBAR_TOKEN} />`,
	);
	console.log("");
	console.log("Register the MCP server with your agent:");
	console.log("  claude mcp add devbar -- devbar mcp");
	console.log("  codex mcp add devbar -- devbar mcp");
}

async function commandServe(args: CliArgs): Promise<void> {
	const token = args.token ?? process.env.DEVBAR_TOKEN ?? (await loadOrCreateToken());
	const fileConfig = await loadConfig(process.cwd());
	const projectConfig = applyConfig(buildProjectConfig(args), fileConfig);

	if (await isServerRunning(args.host, args.port)) {
		await registerWithExistingServer(args.host, args.port, token, projectConfig);
		console.log(
			`project '${projectConfig.slug}' registered with existing server at http://${args.host}:${args.port}`,
		);
		process.exit(0);
	}

	const { start, dir, registry } = await createLocalServer({
		port: args.port,
		host: args.host,
		token,
		onReport: (filePath) => {
			console.log(`report saved: ${filePath}`);
		},
	});

	await registry.register(projectConfig);
	const addr = await start();
	console.log(`devbar local server running at http://${addr.host}:${addr.port}`);
	if (addr.host !== "127.0.0.1" && addr.host !== "localhost") {
		console.log(
			"  WARNING: bound beyond loopback. Anyone who can reach this port and present the token " +
				"can run an agent in your project directory.",
		);
	}
	console.log(`writing reports to ${dir}`);
	console.log(`project '${projectConfig.slug}' registered (${projectConfig.dir})`);
	console.log(
		`  agent=${projectConfig.command ?? "claude"} model=${projectConfig.model} ` +
			`permission=${projectConfig.permission ?? "plan"} concurrency=${projectConfig.concurrency}`,
	);
	console.log(`  auto-dispatch=${projectConfig.autoDispatch}`);
	if (projectConfig.origins?.length) {
		console.log(`  origins=${projectConfig.origins.join(", ")}`);
	} else {
		console.log("  origins=(none) — pages must pass project explicitly; see `devbar init`");
	}
	if (projectConfig.routes?.length) {
		const names = projectConfig.routes.map((r) => (r === "agent" ? "agent" : "webhook"));
		console.log(`  routes=${names.join(", ")}`);
	}
	console.log(`token: ${token}`);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(HELP);
		return;
	}
	if (argv.includes("--version") || argv.includes("-v")) {
		console.log(DEVBAR_VERSION);
		return;
	}

	const args = parseArgs(argv);
	const command = args.positional[0];

	switch (command) {
		case "mcp": {
			// stdout belongs to the MCP protocol from here on.
			const { startLocalMcp } = await import("./mcp/local");
			await startLocalMcp({ url: args.server, token: args.token, project: args.project });
			return;
		}
		case "doctor":
			return commandDoctor(args);
		case "tasks":
			return commandTasks(args);
		case "reports":
			return commandReports(args);
		case "dispatch":
			return commandDispatch(args);
		case "init":
			return commandInit();
		case "link":
			return commandLink(args);
		default:
			return commandServe(args);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
