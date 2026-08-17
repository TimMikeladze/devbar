import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function CustomToolsPage() {
	return (
		<main>
			<PageContent
				title="Custom Tools (select + marker only)"
				description="Only select and marker tools enabled. Draw and capture should not appear in the toolbar."
			/>
			<Devbar
				tools={["select", "marker"]}
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
