import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function ServerNoAuthPage() {
	return (
		<main>
			<PageContent
				title="Server (no auth)"
				description="Server URL set but no auth configured. Submit button should be visible without sign-in. No sign-in button should appear."
			/>
			<Devbar
				server="http://localhost:3100"
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
