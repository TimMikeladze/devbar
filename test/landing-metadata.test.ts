import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const HTML = readFileSync(resolve(root, "app/index.html"), "utf8");
const APP = readFileSync(resolve(root, "app/src/App.tsx"), "utf8");

function meta(attr: "name" | "property", key: string): string {
	const match = HTML.match(new RegExp(`<meta[^>]*\\b${attr}="${key}"[^>]*content="([^"]*)"`, "s"));
	if (match) return match[1];
	// The formatter breaks long tags across lines, putting content before the
	// name/property attribute as often as after it.
	const reversed = HTML.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, "s"));
	return reversed?.[1] ?? "";
}

const jsonLd = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
	(m) => JSON.parse(m[1]) as Record<string, unknown>,
);

const TITLE = HTML.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";

describe("landing metadata", () => {
	test("the title is the hero headline, and the social titles repeat it", () => {
		// The headline is two lines in the markup, so match its halves.
		expect(APP).toContain("Point at what to change.");
		expect(APP).toContain("Your agent ships it.");
		expect(TITLE).toBe("devbar.sh — Point at what to change. Your agent ships it.");
		expect(meta("property", "og:title")).toBe(TITLE);
		expect(meta("name", "twitter:title")).toBe(TITLE);
		expect(HTML).toContain(`<h1>${TITLE}</h1>`);
	});

	test("the description is present and short enough to survive a SERP", () => {
		const description = meta("name", "description");
		expect(description.length).toBeGreaterThan(50);
		expect(description.length).toBeLessThanOrEqual(220);
		expect(meta("property", "og:description").length).toBeGreaterThan(50);
		expect(meta("name", "twitter:description")).toBe(meta("property", "og:description"));
	});

	test("the OG image is a file that actually ships", () => {
		const url = meta("property", "og:image");
		expect(url.startsWith("https://devbar.sh/")).toBe(true);
		const file = url.replace("https://devbar.sh/", "");
		expect(existsSync(resolve(root, "app/public", file))).toBe(true);
		expect(meta("property", "og:image:secure_url")).toBe(url);
		expect(meta("name", "twitter:image")).toBe(url);
	});

	test("every JSON-LD block parses", () => {
		expect(jsonLd.length).toBe(3);
		for (const block of jsonLd) expect(block["@context"]).toBe("https://schema.org");
	});
});

describe("FAQ structured data", () => {
	const faq = jsonLd.find((b) => b["@type"] === "FAQPage") as
		| { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
		| undefined;

	test("the FAQ block exists and is not empty", () => {
		expect(faq?.mainEntity.length).toBeGreaterThan(0);
	});

	/**
	 * Google treats FAQ markup a visitor cannot find on the page as a violation,
	 * so every entry has to be rendered by the FAQ section too. Answers whose
	 * text depends on a build flag are deliberately left out of the markup.
	 */
	test.each((faq?.mainEntity ?? []).map((q) => [q.name, q.acceptedAnswer.text]))(
		"%s is rendered on the page",
		(question, answer) => {
			expect(APP).toContain(question);
			expect(APP).toContain(answer);
		},
	);
});
