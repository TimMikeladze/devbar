let _activeOrgId: string | null = null;

export function setActiveOrgId(orgId: string | null) {
	_activeOrgId = orgId;
}

export async function api<T = unknown>(
	path: string,
	opts?: RequestInit,
): Promise<T> {
	const headers: Record<string, string> = {};
	if (_activeOrgId) {
		headers["X-Deloop-Org"] = _activeOrgId;
	}
	const method = opts?.method?.toUpperCase() ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(`/api${path}`, {
		credentials: "include",
		...opts,
		headers: {
			...headers,
			...opts?.headers,
		},
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `Request failed: ${res.status}`);
	}
	return res.json();
}
