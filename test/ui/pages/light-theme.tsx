import { Devbar } from "../../../src";
import { PageContent } from "./content";

export function LightThemePage() {
	return (
		<main>
			<PageContent title="Light Theme" description="Toolbar initialized with light theme." />
			<Devbar
				local={false}
				theme="light"
				onSubmit={(payload) => console.log("Devbar payload:", payload)}
			/>
		</main>
	);
}
