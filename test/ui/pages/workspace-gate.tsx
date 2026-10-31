import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function WorkspaceGatePage() {
	return (
		<main>
			<PageContent
				title="Deployed workspace"
				description="The toolbar shows only for someone the workspace at /api/devbar admits."
			/>
			<Devbar workspace="/api/devbar" />
		</main>
	);
}
