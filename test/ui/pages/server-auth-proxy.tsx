import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function ServerAuthProxyPage() {
	return (
		<main>
			<PageContent
				title="Server + Auth Proxy"
				description="Server URL with authProxy configured. Sign-in button should appear. Auth modal available. Session check runs on mount."
			/>
			<Devbar
				local={false}
				server="http://localhost:3100"
				authProxy="http://localhost:3100/api/auth/token"
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
