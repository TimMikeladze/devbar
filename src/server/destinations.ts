import type { DeloopPayload } from "@/session/types";
import type { Destination } from "../config";
import { sendWebhook } from "../output/webhook";

export type FanOutContext = {
	/** Path to the saved report JSON on disk. */
	filePath: string;
	/** Project slug the report belongs to. */
	project: string;
	/** The saved report payload. */
	payload: unknown;
};

export type FanOutDeps = {
	/** Wraps dispatcher.enqueue — returns the task id ("" if the slug is unknown). */
	enqueue: (filePath: string, project: string) => string;
};

/**
 * Route a saved report to each configured destination.
 * "agent" enqueues the dispatcher; { webhook } POSTs the payload.
 * Webhook delivery is fire-and-forget: a failure is logged, never thrown, so
 * one bad destination can't block the others.
 */
export async function fanOut(
	destinations: Destination[],
	ctx: FanOutContext,
	deps: FanOutDeps,
): Promise<{ taskId?: string }> {
	let taskId: string | undefined;
	for (const dest of destinations) {
		if (dest === "agent") {
			const id = deps.enqueue(ctx.filePath, ctx.project);
			if (id) taskId = id;
		} else if (dest && typeof dest === "object" && "webhook" in dest) {
			try {
				await sendWebhook(dest.webhook, ctx.payload as DeloopPayload);
			} catch (err) {
				console.log(`[deloop] webhook destination failed: ${err}`);
			}
		}
	}
	return { taskId };
}
