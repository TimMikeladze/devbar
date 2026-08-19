import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function AutoThemePage() {
	return (
		<main>
			<PageContent title="Auto Theme" description="Toolbar initialized with auto (system) theme." />
			<Devbar
				local={false}
				theme="auto"
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
