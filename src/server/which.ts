import { spawn } from "node:child_process";

/**
 * Resolve a command the way the shell would. Returns the first match, or
 * undefined when the command is not on PATH.
 */
export function which(command: string): Promise<string | undefined> {
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
