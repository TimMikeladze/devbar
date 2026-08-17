import type { DevbarPayload } from "@/session/types";

export async function copyToClipboard(payload: DevbarPayload): Promise<void> {
	try {
		await navigator.clipboard.writeText(payload.prompt);
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = payload.prompt;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand("copy");
		document.body.removeChild(textarea);
	}
}
