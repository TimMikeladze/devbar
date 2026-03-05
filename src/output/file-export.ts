import type { DeloopPayload } from "@/session/types";

export function exportToFile(payload: DeloopPayload): void {
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	a.download = `deloop-report-${timestamp}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
