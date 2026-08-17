import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

let _client: ReturnType<
	typeof createAuthClient<{
		plugins: [ReturnType<typeof organizationClient>];
	}>
> | null = null;

export function getAuthClient(serverUrl: string): NonNullable<typeof _client> {
	if (!_client) {
		_client = createAuthClient({
			baseURL: serverUrl,
			plugins: [organizationClient()],
		});
	}
	return _client;
}

export function resetAuthClient(): void {
	_client = null;
}

export type DevbarAuthClient = ReturnType<typeof getAuthClient>;
