import type { DevbarPayload } from "@/session/types";

/** Clipboard write with the execCommand fallback for older/denied contexts. */
export async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand("copy");
		document.body.removeChild(textarea);
	}
}

export async function copyToClipboard(payload: DevbarPayload): Promise<void> {
	await copyText(payload.prompt);
}

/** The whole payload, not just the prompt — every captured field. */
export async function copyPayloadJson(payload: DevbarPayload): Promise<void> {
	await copyText(JSON.stringify(payload, null, 2));
}
