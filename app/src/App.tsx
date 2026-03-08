import { useEffect, useRef, useState, type FormEvent } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { Deloop } from "deloop.dev";
import "deloop.dev/styles.css";
import { PricingCards } from "./components/PricingCards";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-dark-default"],
			langs: ["typescript", "bash", "html", "tsx", "json"],
		});
	}
	return highlighterPromise;
}

function useReveal() {
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					el.classList.add("visible");
					observer.disconnect();
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return ref;
}

function App() {
	useEffect(() => {
		document.title = "deloop.dev — Annotate Any Website, Prompt Any LLM";
		document.documentElement.style.background = "#0a0a0a";
		return () => {
			document.documentElement.style.background = "";
		};
	}, []);

	return (
		<div className="landing-dark min-h-screen hero-glow">
			<Header />
			<main className="max-w-5xl mx-auto px-5 sm:px-8 pt-20 sm:pt-24 pb-10">
				<Hero />
				<Examples />
				<TheProblem />
				<UseCases />
				<Features />
				<Pricing />
				<FAQ />
				<Contact />
				<Footer />
			</main>
			<Deloop />
		</div>
	);
}

function Header() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [open]);

	const links = [
		{ href: "#pricing", label: "Pricing" },
		{ href: "#faq", label: "FAQ" },
		{ href: "#contact", label: "Contact" },
		{ href: "https://github.com/TimMikeladze/deloop", label: "GitHub", external: true },
	];

	return (
		<header className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-xl border-b border-border/50">
			<div className="max-w-5xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
				<a href="/" className="text-fg font-semibold tracking-tight">
					deloop.dev
				</a>

				{/* Desktop nav */}
				<nav className="hidden sm:flex items-center gap-5 text-[13px]">
					{links.map((l) => (
						<a
							key={l.href}
							href={l.href}
							{...("external" in l ? { target: "_blank", rel: "noopener noreferrer" } : {})}
							className="text-muted hover:text-fg transition-colors"
						>
							{l.label}
						</a>
					))}
					<a href="/login" className="text-fg hover:text-fg/80 transition-colors font-medium">
						Sign In
					</a>
					<a
						href="/login?signup=1"
						className="text-bg bg-fg rounded-md px-3 py-1 font-medium hover:bg-fg/85 transition-colors"
					>
						Sign Up
					</a>
				</nav>

				{/* Mobile hamburger */}
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="sm:hidden flex flex-col gap-[5px] p-2 -mr-2 cursor-pointer"
					aria-label="Toggle menu"
				>
					<span
						className={`block w-4 h-[1.5px] bg-fg transition-all ${open ? "rotate-45 translate-y-[6.5px]" : ""}`}
					/>
					<span className={`block w-4 h-[1.5px] bg-fg transition-all ${open ? "opacity-0" : ""}`} />
					<span
						className={`block w-4 h-[1.5px] bg-fg transition-all ${open ? "-rotate-45 -translate-y-[6.5px]" : ""}`}
					/>
				</button>
			</div>

			{/* Mobile dropdown */}
			{open && (
				<nav className="mobile-menu sm:hidden border-t border-border/50 bg-bg/95 backdrop-blur-xl px-5 py-4 space-y-1">
					{links.map((l) => (
						<a
							key={l.href}
							href={l.href}
							onClick={() => setOpen(false)}
							{...("external" in l ? { target: "_blank", rel: "noopener noreferrer" } : {})}
							className="block py-2 text-[14px] text-muted hover:text-fg transition-colors"
						>
							{l.label}
						</a>
					))}
					<div className="border-t border-border/50 pt-3 mt-3 flex items-center gap-3">
						<a href="/login" className="text-[14px] text-fg font-medium">
							Sign In
						</a>
						<a
							href="/login?signup=1"
							className="text-[13px] text-bg bg-fg rounded-md px-3 py-1.5 font-medium hover:bg-fg/85 transition-colors"
						>
							Sign Up
						</a>
					</div>
				</nav>
			)}
		</header>
	);
}

function Hero() {
	return (
		<section className="mb-14 sm:mb-18">
			<p className="text-muted text-[13px] tracking-wide mb-4">Open source</p>
			<h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.5rem] font-bold tracking-[-0.025em] leading-[1.08] mb-4">
				Annotate any website,
				<br />
				<span className="gradient-agent">prompt any LLM.</span>
			</h1>
			<p className="text-dim text-[15px] sm:text-base leading-[1.7] mb-6 max-w-xl">
				Drop-in toolbar that turns visual feedback into AI-ready context. Select elements, draw,
				screenshot, and export structured prompts with XPaths, styles, and React component trees —
				feed directly to your AI agent or paste into any LLM for instant fixes.
			</p>
			<CodeBlock lang="bash" code={`bun add deloop.dev`} />
		</section>
	);
}

function Examples() {
	const [tab, setTab] = useState(0);

	const tabs = [
		{
			label: "React",
			color: "bg-accent",
			title: "React",
			desc: "One component. Everything captured on submit.",
		},
		{
			label: "Script tag",
			color: "bg-cyan",
			title: "Script tag",
			desc: "No build step. Works on any HTML page.",
		},
		{
			label: "Vanilla",
			color: "bg-amber",
			title: "Vanilla JS",
			desc: "Programmatic init for any JavaScript app.",
		},
		{
			label: "Markdown",
			color: "bg-emerald",
			title: "Markdown output",
			desc: "What gets copied to clipboard — paste into any LLM.",
		},
		{
			label: "JSON",
			color: "bg-rose",
			title: "JSON output",
			desc: "The full structured payload — download or POST to a webhook.",
		},
	];

	const examples = [
		{
			lang: "tsx",
			code: `import { Deloop } from "deloop.dev";
import "deloop.dev/styles.css";

<Deloop onSubmit={(payload) => console.log(payload.prompt)} />`,
		},
		{
			lang: "html",
			code: `<script src="https://unpkg.com/deloop.dev/cdn"></script>
<script>
  window.Deloop.init();
</script>`,
		},
		{
			lang: "typescript",
			code: `import { init } from "deloop.dev";
import "deloop.dev/styles.css";

const { destroy } = init();`,
		},
		{
			lang: "bash",
			code: `# Bug Report

## Page Information
- **URL:** https://app.example.com/dashboard
- **Route:** /dashboard?tab=orders
- **Title:** Dashboard — Example App
- **Viewport:** 1440x900
- **User Agent:** Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...

## Annotations

### Annotation 1: element
> **QA:** Button color doesn't match the design spec
- **Tag:** button
- **ID:** submit-btn
- **Classes:** btn, btn-primary
- **XPath:** \`/html/body/div/main/form/button\`
- **CSS Selector:** \`#submit-btn\`
- **Bounding Rect:** 120x40 at (450, 320)
- **Computed Styles:**
  - display: flex
  - color: rgb(255, 255, 255)
  - background-color: rgb(59, 130, 246)
  - font-size: 14px
  - padding: 8px 16px
- **Text:** Submit Order
- **HTML:**
\`\`\`
<button id="submit-btn" class="btn btn-primary">Submit Order</button>
\`\`\`
- **React Component Path:** \`App > Dashboard > OrderForm > Button\`
  - \`<Button variant="primary" size="md">\` (src/ui/Button.tsx:6)
  - \`<OrderForm onSubmit="[Function]">\` (src/components/OrderForm.tsx:24)

### Annotation 2: drawing
- **Type:** Freehand drawing
- **Drawing:** ![drawing](data:image/png;base64,...)
- **Context Screenshot:** ![context](data:image/png;base64,...)

### Annotation 3: marker
> **Designer:** This row is misaligned with the header
- **Marker #1**
- **Position:** (680, 445)
- **Nearest Element XPath:** \`/html/body/div/main/table/tr[3]\`
- **Nearest Element CSS Selector:** \`main > table > tr:nth-of-type(3)\`

### Annotation 4: screenshot
- **Region:** 400x300 at (100, 200)
- **Image:** ![screenshot](data:image/png;base64,...)

## Request
Based on the annotations above, please analyze the issues
found on this page and suggest specific fixes.
Include code changes where applicable.`,
		},
		{
			lang: "json",
			code: `{
  "url": "https://app.example.com/dashboard",
  "route": { "pathname": "/dashboard", "search": "?tab=orders", "hash": "" },
  "title": "Dashboard — Example App",
  "viewport": { "width": 1440, "height": 900 },
  "userAgent": "Mozilla/5.0 ...",
  "timestamp": 1741267800000,
  "annotations": [
    {
      "id": "a_1",
      "type": "element",
      "timestamp": 1741267790000,
      "comments": [
        { "id": "c_1", "author": "QA", "text": "Button color doesn't match design" }
      ],
      "data": {
        "tagName": "button",
        "id": "submit-btn",
        "classes": ["btn", "btn-primary"],
        "xpath": "/html/body/div/main/form/button",
        "cssSelector": "#submit-btn",
        "boundingRect": { "x": 450, "y": 320, "width": 120, "height": 40 },
        "computedStyles": {
          "display": "flex",
          "color": "rgb(255, 255, 255)",
          "background-color": "rgb(59, 130, 246)",
          "font-size": "14px",
          "padding": "8px 16px"
        },
        "innerText": "Submit Order",
        "outerHTML": "<button id=\\"submit-btn\\" class=\\"btn btn-primary\\">Submit Order</button>",
        "reactContext": {
          "componentPath": "App > Dashboard > OrderForm > Button",
          "components": [
            {
              "name": "Button",
              "props": { "variant": "primary", "size": "md" },
              "source": { "fileName": "src/ui/Button.tsx", "lineNumber": 6 }
            },
            {
              "name": "OrderForm",
              "props": { "onSubmit": "[Function]" },
              "source": { "fileName": "src/components/OrderForm.tsx", "lineNumber": 24 }
            }
          ]
        }
      }
    },
    {
      "id": "a_2",
      "type": "drawing",
      "timestamp": 1741267792000,
      "comments": [],
      "data": {
        "imageDataUri": "data:image/png;base64,...",
        "screenshotDataUri": "data:image/png;base64,...",
        "viewportOffset": { "x": 0, "y": 120 },
        "dimensions": { "width": 500, "height": 300 }
      }
    },
    {
      "id": "a_3",
      "type": "marker",
      "timestamp": 1741267794000,
      "comments": [
        { "id": "c_2", "author": "Designer", "text": "Row misaligned with header" }
      ],
      "data": {
        "number": 1,
        "position": { "x": 680, "y": 445 },
        "color": "#ef4444",
        "nearestElementXPath": "/html/body/div/main/table/tr[3]",
        "nearestElementCssSelector": "main > table > tr:nth-of-type(3)",
        "nearestReactContext": null
      }
    },
    {
      "id": "a_4",
      "type": "screenshot",
      "timestamp": 1741267796000,
      "comments": [],
      "data": {
        "imageDataUri": "data:image/png;base64,...",
        "region": { "x": 100, "y": 200, "width": 400, "height": 300 },
        "fullPage": false
      }
    }
  ],
  "prompt": "# Bug Report\\n\\n## Page Information\\n- **URL:** ..."
}`,
		},
	];

	return (
		<section className="mb-14 sm:mb-18">
			<div className="flex items-center gap-1 mb-3 overflow-x-auto tabs-scroll pb-1 -mx-5 px-5 sm:mx-0 sm:px-0">
				{tabs.map((t, i) => (
					<button
						key={t.label}
						onClick={() => setTab(i)}
						className={`inline-flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
							tab === i ? "text-fg bg-white/[0.06]" : "text-muted hover:text-dim"
						}`}
					>
						<span
							className={`block w-1.5 h-1.5 rounded-full ${t.color} ${tab === i ? "opacity-100" : "opacity-30"}`}
						/>
						{t.label}
					</button>
				))}
			</div>
			<div className="mb-3">
				<p className="text-sm font-medium text-fg">{tabs[tab]!.title}</p>
				<p className="text-[13px] text-muted leading-relaxed mt-1">{tabs[tab]!.desc}</p>
			</div>
			<CodeBlock lang={examples[tab]!.lang} code={examples[tab]!.code} />
		</section>
	);
}

function TheProblem() {
	const ref = useReveal();
	return (
		<section ref={ref} className="mb-14 sm:mb-18 reveal">
			<h2 className="text-lg font-semibold text-fg mb-1">Close the feedback loop</h2>
			<p className="text-[13px] text-muted leading-relaxed max-w-2xl mb-4">
				Bug reports today are broken. A screenshot in Slack, a vague ticket, three follow-ups to
				reproduce. By the time someone has enough context, the feedback is stale and the fix takes
				longer than it should.
			</p>
			<p className="text-[13px] text-muted leading-relaxed max-w-2xl mb-4">
				deloop captures everything in one interaction — the exact element, its selectors, computed
				styles, React component tree with source file locations, and a screenshot of the surrounding
				area. No context lost, no ambiguity left.
			</p>
			<p className="text-[13px] text-muted leading-relaxed max-w-2xl">
				Use it in your local dev flow and the report goes directly to your AI agent via webhook or
				onSubmit — no copy-paste needed. Or use it across your team so designers, QA, and PMs can
				file structured reports that developers (or LLMs) can act on immediately. Either way, spot
				it, annotate it, fix it.
			</p>
		</section>
	);
}

function UseCases() {
	const ref = useReveal();
	const roles = [
		{
			color: "bg-emerald",
			role: "Local development",
			desc: "Wire onSubmit or a webhook to your AI agent. See a bug, annotate it, and the structured context goes directly to Claude, Cursor, or your own pipeline — no copy-paste, no context switching.",
		},
		{
			color: "bg-accent",
			role: "Designers",
			desc: "Spot a spacing issue, select the element, and submit. The report includes the exact CSS values, bounding rect, and component source — so developers fix the right thing on the first try.",
		},
		{
			color: "bg-cyan",
			role: "QA & Reviewers",
			desc: 'Annotate bugs with markers, drawings, and screenshots in context. Every report is structured and reproducible — no more guesswork, no more "works on my machine."',
		},
		{
			color: "bg-amber",
			role: "Product Managers",
			desc: "Give feedback directly on staging without leaving the browser. The toolbar captures everything a developer needs — no follow-up questions, no lost context.",
		},
	];

	return (
		<section ref={ref} className="mb-14 sm:mb-18 reveal">
			<h2 className="text-lg font-semibold text-fg mb-1">
				Built for every role in the iteration loop
			</h2>
			<p className="text-[13px] text-muted mb-5 max-w-2xl">
				Whether you&apos;re a solo developer feeding annotations to your AI agent or a team
				coordinating across design, QA, and engineering — deloop captures the context that closes
				the gap between spotting a bug and shipping the fix.
			</p>
			<div className="grid sm:grid-cols-2 gap-x-12 gap-y-4">
				{roles.map((r) => (
					<div key={r.role} className="flex items-start gap-3">
						<span className={`mt-[7px] block w-1.5 h-1.5 rounded-full ${r.color} shrink-0`} />
						<div>
							<p className="text-sm font-medium text-fg">{r.role}</p>
							<p className="text-[13px] text-muted">{r.desc}</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function Features() {
	const ref = useReveal();
	const features = [
		{
			color: "bg-accent",
			label: "Element inspector",
			desc: "Click any element to capture its XPath, CSS selector, computed styles, bounding rect, inner text, and outer HTML — everything an LLM needs to locate and fix it",
		},
		{
			color: "bg-cyan",
			label: "React context extraction",
			desc: "Automatically walks the React fiber tree to capture the full component hierarchy, props, and source file locations — all locally in the browser, no server required",
		},
		{
			color: "bg-emerald",
			label: "Freehand drawing",
			desc: "Circle a problem, underline text, or sketch what the layout should look like. Each drawing includes a context screenshot of the surrounding area",
		},
		{
			color: "bg-amber",
			label: "Screenshot capture",
			desc: "Capture the full page or drag to select a region. Export as base64 embedded in the prompt or as separate image files",
		},
		{
			color: "bg-rose",
			label: "Numbered markers",
			desc: "Drop numbered pins to call out specific areas. Each marker auto-detects the nearest DOM element and captures its XPath and CSS selector",
		},
		{
			color: "bg-cyan",
			label: "Comments & threads",
			desc: "Add comments to any annotation to explain the issue. Comments are included in the exported report for full context",
		},
		{
			color: "bg-emerald",
			label: "LLM-ready Markdown",
			desc: "One-click export as structured Markdown with page URL, viewport size, user agent, and every annotation — ready to paste into any LLM chat",
		},
		{
			color: "bg-accent",
			label: "JSON & file export",
			desc: "Download the full structured payload as JSON or Markdown. Images can be embedded inline or saved as separate PNG files",
		},
		{
			color: "bg-amber",
			label: "Clipboard & webhook",
			desc: "Copy to clipboard for instant pasting, or POST to any webhook URL to feed your own bug tracker, Slack bot, or CI pipeline",
		},
		{
			color: "bg-rose",
			label: "Custom prompt templates",
			desc: "Pass your own template function to control exactly what the LLM sees. Receives all annotations, page context, and settings",
		},
		{
			color: "bg-cyan",
			label: "Chrome extension",
			desc: "Use deloop on any website — staging environments, competitor sites, third-party tools — without modifying source code",
		},
		{
			color: "bg-emerald",
			label: "CDN script tag",
			desc: "One script tag, zero build step. Works on any HTML page regardless of framework — WordPress, Shopify, static sites, anything",
		},
		{
			color: "bg-accent",
			label: "Plugin system",
			desc: "Extend the toolbar with custom tools, panels, and buttons. Add performance metrics, accessibility checks, or whatever your team needs",
		},
		{
			color: "bg-amber",
			label: "Theme & positioning",
			desc: "Light, dark, or auto theme that matches the user's system. Place the toolbar in any corner. Draggable and minimizable by default",
		},
	];

	return (
		<section ref={ref} className="mb-14 sm:mb-18 reveal">
			<h2 className="text-lg font-semibold text-fg mb-1">Everything captured, nothing lost</h2>
			<p className="text-[13px] text-muted mb-5 max-w-2xl">
				Every annotation automatically captures the surrounding context — selectors, styles,
				components, screenshots — so the person fixing the bug has everything they need without
				asking.
			</p>
			<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-4">
				{features.map((f) => (
					<div key={f.label} className="flex items-start gap-3">
						<span className={`mt-[7px] block w-1.5 h-1.5 rounded-full ${f.color} shrink-0`} />
						<div>
							<p className="text-sm font-medium text-fg">{f.label}</p>
							<p className="text-[13px] text-muted">{f.desc}</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function Pricing() {
	const ref = useReveal();
	return (
		<section ref={ref} id="pricing" className="mb-14 sm:mb-18 scroll-mt-20 reveal">
			<h2 className="text-lg font-semibold text-fg mb-1">Pricing</h2>
			<p className="text-[13px] text-muted mb-5 max-w-2xl">
				Self-host for free with every feature included. Or use the hosted version for team
				dashboards and report history.
			</p>
			<PricingCards />
		</section>
	);
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState("");
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		getHighlighter().then((h) => {
			setHtml(
				h.codeToHtml(code, {
					lang,
					theme: "github-dark-default",
				}),
			);
		});
	}, [code, lang]);

	const handleCopy = () => {
		navigator.clipboard.writeText(code).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	return (
		<div className="code-block-wrap rounded-lg border border-border overflow-hidden">
			<button type="button" onClick={handleCopy} className="code-copy-btn" aria-label="Copy code">
				{copied ? (
					<>
						<svg width="12" height="12" viewBox="0 0 14 14" fill="none">
							<path
								d="M3 7.5L6 10.5L11 4"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						Copied
					</>
				) : (
					<>
						<svg width="12" height="12" viewBox="0 0 14 14" fill="none">
							<rect
								x="5"
								y="5"
								width="7"
								height="7"
								rx="1.5"
								stroke="currentColor"
								strokeWidth="1.2"
							/>
							<path
								d="M9 5V3.5A1.5 1.5 0 007.5 2H3.5A1.5 1.5 0 002 3.5V7.5A1.5 1.5 0 003.5 9H5"
								stroke="currentColor"
								strokeWidth="1.2"
							/>
						</svg>
						Copy
					</>
				)}
			</button>
			{html ? (
				<div
					className="[&_pre]:p-4 [&_pre]:sm:p-5 [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_pre]:sm:text-[13px] [&_pre]:leading-[1.7] [&_pre]:!bg-bg-code [&_code]:font-mono"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="p-4 sm:p-5 overflow-x-auto bg-bg-code text-[12px] sm:text-[13px] leading-[1.7]">
					<code className="text-fg/70 font-mono">{code}</code>
				</pre>
			)}
		</div>
	);
}

function FAQ() {
	const faqs = [
		{
			q: "How does this speed up iteration cycles?",
			a: "For solo devs, wire onSubmit to your AI agent — annotate a bug and the structured context goes directly to the LLM without copy-pasting. For teams, it eliminates the back-and-forth: selectors, styles, component trees, and screenshots are captured in one interaction so the fix can start immediately.",
		},
		{
			q: "How does React context extraction work?",
			a: "When you select an element, deloop reads the React fiber node attached to the DOM element and walks up the tree. It captures every parent component's name, props, and source file location. This all happens locally in your browser — nothing is sent to a server until you click submit.",
		},
		{
			q: "Does it work without React?",
			a: "Yes. Element selection, XPaths, CSS selectors, computed styles, drawing, screenshots, and markers work on any website. React context is captured automatically when React is detected and gracefully skipped otherwise.",
		},
		{
			q: "Who is this for?",
			a: "Anyone who works on a website. Developers use it in their local flow to feed annotations directly to an AI agent. Designers flag styling issues with exact CSS values. QA files structured, reproducible reports. PMs annotate staging without leaving the browser.",
		},
		{
			q: "What output formats are supported?",
			a: "Clipboard copy as Markdown (paste straight into ChatGPT or Claude), downloadable JSON or Markdown files, and webhook POST to any URL. Images can be embedded as base64 or exported as separate PNG files.",
		},
		{
			q: "Can I customize what gets sent to the LLM?",
			a: "Yes. Pass a promptTemplate function that receives all annotations, page URL, viewport, user agent, and settings. Return any string — Markdown, XML, plain text, or a format tailored to your LLM workflow.",
		},
		{
			q: "How do I use it on sites I don't own?",
			a: "Install the Chrome extension. It injects the toolbar into any page — staging environments, competitor sites, third-party tools — without modifying source code.",
		},
		{
			q: "Does it affect my app's performance?",
			a: "No. The toolbar renders in its own isolated DOM container. It only reads the page when you interact with a tool — no polling, no mutation observers, no background overhead.",
		},
		{
			q: "Why not just use browser DevTools?",
			a: "DevTools is built for developers. deloop is a toolbar you embed in your app so anyone on your team can capture rich, structured context — without knowing what an XPath is or how to open the inspector.",
		},
	];

	const ref = useReveal();
	return (
		<section ref={ref} id="faq" className="mb-14 sm:mb-18 scroll-mt-20 reveal">
			<h2 className="text-lg font-semibold text-fg mb-5">FAQ</h2>
			<div className="grid sm:grid-cols-2 gap-x-16 gap-y-4">
				{faqs.map((f) => (
					<div key={f.q}>
						<p className="text-sm font-medium text-fg mb-1">{f.q}</p>
						<p className="text-[13px] text-muted leading-relaxed">{f.a}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function Contact() {
	const ref = useReveal();
	const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = e.currentTarget;
		const formData = new FormData(form);
		const email = formData.get("email") as string;
		const message = formData.get("message") as string;

		setStatus("sending");
		try {
			const res = await fetch("/api/contact", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, message }),
			});
			if (!res.ok) throw new Error();
			setStatus("sent");
			form.reset();
			setTimeout(() => setStatus("idle"), 5000);
		} catch {
			setStatus("error");
		}
	};

	return (
		<section ref={ref} id="contact" className="mb-14 sm:mb-18 scroll-mt-20 reveal text-center">
			<h2 className="text-lg font-semibold text-fg mb-1">Contact</h2>
			<p className="text-[13px] text-muted mb-5 max-w-2xl mx-auto">
				Have a question, feature request, or just want to say hi? Send us a message.
			</p>
			<form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-3 text-left">
				<input
					name="email"
					type="email"
					required
					placeholder="Your email"
					className="w-full rounded-lg border border-border bg-bg-code px-3 py-2 text-[13px] text-fg placeholder:text-muted/50 outline-none focus:border-accent/50 transition-colors"
				/>
				<textarea
					name="message"
					required
					rows={4}
					placeholder="Your message"
					className="w-full rounded-lg border border-border bg-bg-code px-3 py-2 text-[13px] text-fg placeholder:text-muted/50 outline-none focus:border-accent/50 transition-colors resize-y"
				/>
				<div className="flex items-center gap-3">
					<button
						type="submit"
						disabled={status === "sending" || status === "sent"}
						className="text-bg bg-fg rounded-md px-4 py-1.5 text-[13px] font-medium hover:bg-fg/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{status === "sending" ? "Sending..." : status === "sent" ? "Sent" : "Send message"}
					</button>
					{status === "sent" && (
						<span className="text-emerald text-[13px]">Thanks! We'll get back to you soon.</span>
					)}
					{status === "error" && (
						<span className="text-rose text-[13px]">Something went wrong. Please try again.</span>
					)}
				</div>
			</form>
		</section>
	);
}

function Footer() {
	return (
		<footer className="border-t border-border pt-8 mt-4">
			<div className="flex flex-wrap items-center justify-between gap-4 text-[13px] text-muted">
				<div className="flex items-center gap-5">
					<a
						href="https://github.com/TimMikeladze/deloop"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
						</svg>
						GitHub
					</a>
					<a
						href="https://www.npmjs.com/package/deloop.dev"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M0 0v16h16V0H0zm13 13H8V5h2.5v5.5H13V5h-1.5V3H3v10h10v-3z" />
						</svg>
						npm
					</a>
					<a
						href="https://github.com/TimMikeladze/deloop/releases"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M3 8.5V13a1 1 0 001 1h8a1 1 0 001-1V8.5M8 2v8M5 5l3-3 3 3" />
						</svg>
						Releases
					</a>
				</div>
				<div className="flex items-center gap-5">
					<a
						href="https://x.com/linesofcode"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
							<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
						</svg>
						X
					</a>
					<a
						href="https://bsky.app/profile/linesofcode.bsky.social"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
					>
						<svg width="14" height="14" viewBox="0 0 568 501" fill="currentColor">
							<path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32 353.473 576.312 301.061 422.461 287.631 383.039c-2.458-7.22-3.503-10.581-3.631-7.734-.128-2.847-1.173.514-3.631 7.734-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.89-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.659 0 75.291 0 57.946 0-28.906 76.135-1.612 123.121 33.664z" />
						</svg>
						Bluesky
					</a>
				</div>
			</div>
			<p className="text-muted/30 text-xs mt-5 pb-8">
				&copy; {new Date().getFullYear()} deloop.dev
			</p>
		</footer>
	);
}

export default App;
