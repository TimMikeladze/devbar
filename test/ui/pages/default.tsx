import { Deloop } from "../../../src";
import { PageContent } from "./content";

export function DefaultPage() {
	return (
		<main>
			<PageContent
				title="Default (no server, no auth)"
				description="Local-only mode. Clipboard and file export only. No server submission, no sign-in button."
			/>
			<Deloop
				onSubmit={(payload) => console.log("Deloop payload:", payload)}
			/>
		</main>
	);
}
