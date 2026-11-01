import { Devbar } from "../../../src";
import type { DevbarPlugin } from "../../../src";
import { PageContent } from "./content";

const plugin: DevbarPlugin = {
	key: "counter",
	label: "Counter",
	icon: () => null,
	setup: (context) =>
		context.subscribe(() => {
			(window as unknown as { annotationCount: number }).annotationCount =
				context.getAnnotations().length;
		}),
};

export function PluginSetupPage() {
	return (
		<main>
			<PageContent
				title="Plugin setup"
				description="A plugin that reads the toolbar's annotations."
			/>
			<Devbar local={false} clipboard plugins={[plugin]} />
		</main>
	);
}
