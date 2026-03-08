import { Deloop } from "../../../src";
import { PageContent } from "./content";

export function DarkThemePage() {
	return (
		<main>
			<PageContent title="Dark Theme" description="Toolbar initialized with dark theme." />
			<Deloop theme="dark" onSubmit={(payload) => console.log("Deloop payload:", payload)} />
		</main>
	);
}
