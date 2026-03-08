import { Deloop } from "../../../src";
import { PageContent } from "./content";

export function LightThemePage() {
	return (
		<main>
			<PageContent title="Light Theme" description="Toolbar initialized with light theme." />
			<Deloop theme="light" onSubmit={(payload) => console.log("Deloop payload:", payload)} />
		</main>
	);
}
