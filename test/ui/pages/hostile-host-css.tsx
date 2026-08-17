import { Devbar } from "../../../src";
import { PageContent } from "./content";

/**
 * The toolbar gets injected into sites we do not control (the Chrome
 * extension does exactly that), so host rules written against bare element
 * selectors land on our markup. This page reproduces the worst of it: a
 * `button { padding }` here once ate the icon buttons' content box and
 * collapsed every glyph to zero width.
 */
const HOSTILE_CSS = `
	* { box-sizing: content-box; }
	button {
		padding: 20px 40px;
		border: 3px solid red;
		background: yellow;
		font-size: 28px;
		text-transform: uppercase;
		letter-spacing: 4px;
		border-radius: 999px;
		box-shadow: 0 0 20px red;
	}
	svg { width: 120px; height: 120px; }
	input, textarea, select { border: 5px dashed green; padding: 14px; font-size: 22px; }
	p, h1, h2, h3, ul, li { margin: 40px; padding: 20px; }
	ul, li { list-style: square; }
	div { line-height: 4; }
`;

export function HostileHostCssPage() {
	return (
		<main>
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: fixture stylesheet */}
			<style dangerouslySetInnerHTML={{ __html: HOSTILE_CSS }} />
			<PageContent
				title="Hostile host CSS"
				description="Every bare element selector on this page tries to leak into the toolbar."
			/>
			<button type="button">A host button</button>
			<Devbar onSubmit={(payload) => console.log("Devbar payload:", payload)} />
		</main>
	);
}
