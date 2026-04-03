#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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

function parseArgs(argv: string[]): { port: number; host: string; token?: string } {
	let port = 3100;
	let host = "127.0.0.1";
	let token: string | undefined;

	for (let i = 2; i < argv.length; i++) {
		if ((argv[i] === "--port" || argv[i] === "-p") && argv[i + 1]) {
			port = Number.parseInt(argv[++i] as string, 10);
		} else if (argv[i] === "--host" && argv[i + 1]) {
			host = argv[++i] as string;
		} else if ((argv[i] === "--token" || argv[i] === "-t") && argv[i + 1]) {
			token = argv[++i];
		}
	}

	return { port, host, token };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	const token = args.token ?? process.env.DELOOP_TOKEN ?? (await loadOrCreateToken());

	const { start, dir } = await createLocalServer({
		port: args.port,
		host: args.host,
		token,
		onReport: (filePath) => {
			console.log(`report saved: ${filePath}`);
		},
	});

	const addr = await start();
	console.log(`deloop local server running at http://${addr.host}:${addr.port}`);
	console.log(`writing reports to ${dir}`);
	console.log(`token: ${token}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
