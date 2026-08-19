import { Devbar } from "../../../src";
import { PageContent } from "./content";

/**
 * Zero-config path: no server, token, or project props.
 *
 * The toolbar discovers the local devbar server on 127.0.0.1, matches this
 * origin to a project, and — once "Agent live" is switched on in the toolbar's
 * settings — lets an agent inspect and screenshot this page over MCP.
 *
 * To exercise it: `devbar --port 3100` in a project whose devbar.config.ts
 * lists http://localhost:3847 in `origins`.
 */
export function LocalAgentPage() {
	return (
		<main>
			<PageContent
				title="Local agent (auto-discovery)"
				description="No props. The toolbar finds the local devbar server, matches this origin to a project, and can hand the page to an agent."
			/>
			<button
				type="button"
				id="agent-target"
				className="agent-target"
				style={{
					marginTop: 24,
					padding: "10px 18px",
					borderRadius: 8,
					border: "1px solid #888",
					background: "#f43f5e",
					color: "white",
					fontWeight: 600,
				}}
			>
				Inspect me
			</button>
			<Devbar />
		</main>
	);
}
