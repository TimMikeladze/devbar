/**
 * Takes the secrets we can recognise out of a report before it leaves for a
 * GitHub issue. Pattern matching can't spot a customer's name in page text, so
 * this runs ahead of the review step, and doesn't replace it.
 */

const REDACTED = "[redacted]";

const SECRET_PARAMS =
	"access_token|refresh_token|id_token|token|api_?key|apikey|key|secret|password|passwd|pass|auth|code|session|sig|signature";

function passesLuhn(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let d = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 1) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
	}
	return sum % 10 === 0;
}

export function redactReport(text: string): string {
	return (
		text
			// Screenshots: a picture of the page holds everything the rules below remove.
			.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "[image removed]")
			.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[image removed]")
			// Whatever was typed into a field: in HTML, and in the attribute list.
			.replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, `value="${REDACTED}"`)
			.replace(/^(\s*- `value`:).*$/gm, `$1 ${REDACTED}`)
			.replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\n`"']+/gi, `$1: ${REDACTED}`)
			.replace(/\bBearer\s+[\w.~+/=-]+/g, `Bearer ${REDACTED}`)
			.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED)
			.replace(/\b(?:gh[pousr]_\w{20,}|github_pat_\w{20,})/g, REDACTED)
			.replace(/\b(?:sk-[\w-]{20,}|[spr]k_(?:live|test)_\w{10,}|AKIA[0-9A-Z]{16})\b/g, REDACTED)
			.replace(new RegExp(`([?&#](?:${SECRET_PARAMS})=)[^&#\\s"'\`)]+`, "gi"), `$1${REDACTED}`)
			.replace(/\b[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]\b/g, "[email]")
			.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) =>
				passesLuhn(match.replace(/\D/g, "")) ? "[card number]" : match,
			)
	);
}
