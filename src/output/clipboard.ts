import type { DeloopPayload } from "@/session/types";

export async function copyToClipboard(payload: DeloopPayload): Promise<void> {
	await navigator.clipboard.writeText(payload.prompt);
}
