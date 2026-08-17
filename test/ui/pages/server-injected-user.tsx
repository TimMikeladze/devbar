import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function ServerInjectedUserPage() {
	return (
		<main>
			<PageContent
				title="Server + Injected User"
				description="Server URL with user prop injected. User avatar shown in toolbar. No sign-in button, no sign-out possible. Submit sends identity headers."
			/>
			<Devbar
				server="http://localhost:3100"
				user={{
					name: "Jane Doe",
					email: "jane@example.com",
					avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Jane",
				}}
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
