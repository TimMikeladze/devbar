/**
 * Clipboard write with a fallback for browsers that refuse
 * `navigator.clipboard` — Safari without a user gesture in the same task,
 * and any page served over plain HTTP, where the API is undefined.
 *
 * Resolves `true` only when the text actually landed on the clipboard, so
 * callers can avoid showing a "Copied" state that lied.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return legacyCopy(text);
	}
}

/** `document.execCommand("copy")` against an off-screen textarea. */
function legacyCopy(text: string): boolean {
	if (typeof document === "undefined") return false;
	const el = document.createElement("textarea");
	el.value = text;
	el.setAttribute("readonly", "");
	el.style.position = "fixed";
	el.style.top = "-9999px";
	document.body.appendChild(el);
	try {
		el.select();
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		el.remove();
	}
}
