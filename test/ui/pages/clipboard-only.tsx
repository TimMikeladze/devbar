import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function ClipboardOnlyPage() {
	return (
		<main>
			<PageContent
				title="Clipboard Only"
				description="No server, no onSubmit callback. Pure clipboard/export workflow — annotations are cleared after copy."
			/>
			<Devbar clipboard />
		</main>
	);
}
