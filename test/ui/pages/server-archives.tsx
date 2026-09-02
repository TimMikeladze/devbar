import { Devbar } from "../../../src";
import { PageContent } from "./content";

/**
 * A server is configured but nothing intercepts the export, so batches archive
 * under History the way they do on a clipboard-only page. That combination is
 * what puts Submit and Send to agent on an archived record. The port is
 * deliberately one nothing listens on: this fixture is about the controls
 * being offered, not about a server answering.
 */
export function ServerArchivesPage() {
	return (
		<main>
			<PageContent
				title="Server (archives to History)"
				description="Server URL set, no onSubmit — exports archive under History, and archived records offer Submit and Send to agent."
			/>
			<Devbar local={false} server="http://localhost:3999" />
		</main>
	);
}
