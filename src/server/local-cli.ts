#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createLocalServer } from "./local";

const DELOOP_DIR = join(homedir(), ".deloop");
const TOKEN_PATH = join(DELOOP_DIR, "token");

async function loadOrCreateToken(): Promise<string> {
	try {
		const existing = await readFile(TOKEN_PATH, "utf-8");
		const trimmed = existing.trim();
		if (trimmed) return trimmed;
	} catch {}

	await mkdir(DELOOP_DIR, { recursive: true });
	const token = randomUUID();
	await writeFile(TOKEN_PATH, token, "utf-8");
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
	permissionMode: string;
	autoDispatch: boolean;
};

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		port: 3100,
		host: "127.0.0.1",
		model: "sonnet",
		effort: "medium",
		concurrency: 1,
		permissionMode: "plan",
		autoDispatch: true,
	};

	for (let i = 2; i < argv.length; i++) {
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
			case "--concurrency":
				args.concurrency = Number.parseInt(next, 10);
				i++;
				break;
			case "--max-budget":
				args.maxBudget = Number.parseFloat(next);
				i++;
				break;
			case "--permission-mode":
				args.permissionMode = next;
				i++;
				break;
			case "--no-auto":
				args.autoDispatch = false;
				break;
		}
	}

	return args;
}

function buildProjectConfig(args: CliArgs): {
	slug: string;
	dir: string;
	model: string;
	effort: string;
	maxBudgetUsd?: number;
	concurrency: number;
	permissionMode: string;
	autoDispatch: boolean;
} {
	const cwd = process.cwd();
	return {
		slug: args.name ?? basename(cwd),
		dir: cwd,
		model: args.model,
		effort: args.effort,
		maxBudgetUsd: args.maxBudget,
		concurrency: args.concurrency,
		permissionMode: args.permissionMode,
		autoDispatch: args.autoDispatch,
	};
}

async function isServerRunning(host: string, port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://${host}:${port}/health`);
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
	config: ReturnType<typeof buildProjectConfig>,
): Promise<void> {
	const res = await fetch(`http://${host}:${port}/api/projects`, {
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

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	const token = args.token ?? process.env.DELOOP_TOKEN ?? (await loadOrCreateToken());
	const projectConfig = buildProjectConfig(args);

	if (await isServerRunning(args.host, args.port)) {
		await registerWithExistingServer(args.host, args.port, token, projectConfig);
		console.log(`project '${projectConfig.slug}' registered with existing server at http://${args.host}:${args.port}`);
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
	console.log(`deloop local server running at http://${addr.host}:${addr.port}`);
	console.log(`writing reports to ${dir}`);
	console.log(`project '${projectConfig.slug}' registered (${projectConfig.dir})`);
	console.log(`  model=${projectConfig.model} effort=${projectConfig.effort} concurrency=${projectConfig.concurrency}`);
	console.log(`  auto-dispatch=${projectConfig.autoDispatch} permission-mode=${projectConfig.permissionMode}`);
	console.log(`token: ${token}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
