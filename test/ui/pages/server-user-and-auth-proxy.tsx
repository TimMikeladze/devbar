import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function ServerUserAndAuthProxyPage() {
	return (
		<main>
			<PageContent
				title="Server + Injected User + Auth Proxy"
				description="Both user prop and authProxy set. Injected user takes precedence. No sign-in button (already have user). No sign-out (user is injected). Auth proxy used for token on submit."
			/>
			<Devbar
				local={false}
				server="http://localhost:3100"
				user={{
					name: "Jane Doe",
					email: "jane@example.com",
					avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Jane",
				}}
				authProxy="http://localhost:3100/api/auth/token"
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
