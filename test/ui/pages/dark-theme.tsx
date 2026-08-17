import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function DarkThemePage() {
	return (
		<main>
			<PageContent title="Dark Theme" description="Toolbar initialized with dark theme." />
			<Devbar theme="dark" onSubmit={(payload) => console.log("Devbar payload:", payload)} />
		</main>
	);
}
