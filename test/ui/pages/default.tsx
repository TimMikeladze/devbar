import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function DefaultPage() {
	return (
		<main>
			<PageContent
				title="Default (no server, no auth)"
				description="Local-only mode. Clipboard and file export only. No server submission, no sign-in button. Discovery is off so the page behaves the same whether or not a devbar server is running."
			/>
			<Devbar local={false} onSubmit={(payload) => console.log("Devbar payload:", payload)} />
		</main>
	);
}
