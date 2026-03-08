import { Deloop } from "../../../src";
import { PageContent } from "./content";

export function AutoThemePage() {
	return (
		<main>
			<PageContent
				title="Auto Theme"
				description="Toolbar initialized with auto (system) theme."
			/>
			<Deloop
				theme="auto"
				onSubmit={(payload) => console.log("Deloop payload:", payload)}
			/>
		</main>
	);
}
