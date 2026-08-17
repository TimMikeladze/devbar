import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const auth = createAuthClient({
	baseURL: "",
	plugins: [organizationClient()],
});
