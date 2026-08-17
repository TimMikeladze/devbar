import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function DefaultPage() {
	return (
		<main>
			<PageContent
				title="Default (no server, no auth)"
				description="Local-only mode. Clipboard and file export only. No server submission, no sign-in button."
			/>
			<Devbar onSubmit={(payload) => console.log("Devbar payload:", payload)} />
		</main>
	);
}
