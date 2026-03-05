import type { DeloopPayload } from "@/session/types";

export async function sendWebhook(url: string, payload: DeloopPayload): Promise<void> {
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}
