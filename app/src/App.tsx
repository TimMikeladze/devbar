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
				<HowItWorks />
				<Examples />
				<CapturedData />
				<BeforeAfter />
				<Integrations />
				<Pipelines />
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

/* ═══════════════════════════════════════════
   Header
   ═══════════════════════════════════════════ */

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
		{ href: "#how-it-works", label: "How It Works" },
		{ href: "#pricing", label: "Pricing" },
		{ href: "#faq", label: "FAQ" },
		{ href: "https://github.com/TimMikeladze/deloop", label: "GitHub", external: true },
	];

	return (
		<header className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-xl border-b border-border/50">
			<div className="max-w-5xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
				<a href="/" className="text-fg font-semibold tracking-tight">
					deloop.dev
				</a>

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

/* ═══════════════════════════════════════════
   Hero
   ═══════════════════════════════════════════ */

function Hero() {
	return (
		<section className="mb-16 sm:mb-20 flex flex-col lg:flex-row lg:items-start lg:gap-12">
			<div className="flex-1 min-w-0">
				<p className="text-accent text-[11px] tracking-[0.2em] uppercase font-semibold mb-4">
					Open source
				</p>
				<h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.5rem] font-bold tracking-[-0.025em] leading-[1.08] mb-4">
					<span className="font-display italic text-[2.8rem] sm:text-[3.4rem] lg:text-[4rem] tracking-[-0.02em]">
						Annotate
					</span>{" "}
					any website,
					<br />
					<span className="gradient-agent">prompt any LLM.</span>
				</h1>
				<p className="text-dim text-[15px] sm:text-base leading-[1.7] mb-6 max-w-xl">
					Drop-in toolbar that turns visual feedback into AI-ready context. Select elements, draw,
					screenshot, and export structured prompts with XPaths, styles, and React component trees —
					feed directly to your AI agent or paste into any LLM for instant fixes.
				</p>
				<CodeBlock lang="bash" code={`bun add deloop.dev`} />
			</div>

			{/* Floating annotation preview */}
			<div className="hidden lg:block w-[300px] shrink-0 mt-8">
				<HeroAnnotationCard />
			</div>
		</section>
	);
}

function HeroAnnotationCard() {
	return (
		<div className="hero-annotation-card">
			<div className="flex items-center gap-2 text-accent text-[10px] tracking-[0.1em] uppercase font-semibold mb-3">
				<span className="w-[6px] h-[6px] rounded-full bg-accent" />
				Element annotation
			</div>

			<div className="space-y-[6px] text-muted mb-3">
				<div className="flex gap-2">
					<span className="text-muted/60 w-[52px] shrink-0">tag</span>
					<span className="text-fg">button#submit-btn</span>
				</div>
				<div className="flex gap-2">
					<span className="text-muted/60 w-[52px] shrink-0">xpath</span>
					<span className="text-fg text-[10px]">/html/body/div/main/button</span>
				</div>
				<div className="flex gap-2">
					<span className="text-muted/60 w-[52px] shrink-0">css</span>
					<span className="text-fg">#submit-btn</span>
				</div>
			</div>

			<div className="border-t border-border pt-2.5 space-y-[6px] text-muted mb-3">
				<div className="flex items-center gap-2">
					<span className="text-muted/60 w-[52px] shrink-0">bg</span>
					<span className="w-[10px] h-[10px] rounded-sm bg-accent" />
					<span className="text-fg">rgb(59, 130, 246)</span>
				</div>
				<div className="flex gap-2">
					<span className="text-muted/60 w-[52px] shrink-0">font</span>
					<span className="text-fg">14px</span>
				</div>
				<div className="flex gap-2">
					<span className="text-muted/60 w-[52px] shrink-0">rect</span>
					<span className="text-fg">120×40 @ (450, 320)</span>
				</div>
			</div>

			<div className="border-t border-border pt-2.5 text-muted">
				<div className="text-muted/60 text-[9px] tracking-[0.1em] uppercase mb-1">React tree</div>
				<div className="text-emerald text-[10px]">App › Dashboard › Button</div>
				<div className="text-[10px] text-muted/50">src/ui/Button.tsx:6</div>
			</div>
		</div>
	);
}

/* ═══════════════════════════════════════════
   How It Works
   ═══════════════════════════════════════════ */

function HowItWorks() {
	const ref = useReveal();

	const steps = [
		{
			number: 1,
			title: "Annotate",
			color: "accent",
			desc: "Interact with any page using familiar tools — click to select elements, draw freehand, drop numbered markers, or capture screenshots. Add comments to explain each issue.",
			items: [
				"Element selection",
				"Freehand drawing",
				"Numbered markers",
				"Screenshot capture",
				"Comments & threads",
			],
		},
		{
			number: 2,
			title: "Auto-capture",
			color: "emerald",
			desc: "Every annotation automatically extracts rich structured data from the page — no manual copying, no asking for more details.",
			items: [
				"XPaths & CSS selectors",
				"Computed styles",
				"React component tree",
				"Source file locations",
				"Context screenshots",
			],
		},
		{
			number: 3,
			title: "Export",
			color: "cyan",
			desc: "One click turns everything into a structured report. Paste into any LLM, pipe to your AI agent via webhook, or save as files.",
			items: [
				"Markdown for LLMs",
				"JSON payload",
				"Clipboard copy",
				"Webhook POST",
				"File download (.md / .json)",
			],
		},
	];

	const colorMap: Record<string, string> = {
		accent: "bg-accent text-white",
		emerald: "bg-emerald text-white",
		cyan: "bg-cyan text-white",
	};

	const labelColorMap: Record<string, string> = {
		accent: "text-accent",
		emerald: "text-emerald",
		cyan: "text-cyan",
	};

	const lineColorMap: Record<string, string> = {
		accent: "section-label text-accent before:bg-accent",
		emerald: "section-label text-emerald before:bg-emerald",
		cyan: "section-label text-cyan before:bg-cyan",
	};
	void lineColorMap;

	return (
		<section ref={ref} id="how-it-works" className="mb-16 sm:mb-20 scroll-mt-20 reveal">
			<p className="section-label text-accent before:bg-accent">How it works</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Three steps to close the feedback loop
			</h2>
			<p className="text-[13px] text-muted mb-8 max-w-2xl">
				Spot an issue, annotate it, and get a structured report that any developer or LLM can act on
				immediately. No back-and-forth, no lost context.
			</p>

			<div className="flex flex-col sm:flex-row items-stretch gap-4 sm:gap-0">
				{steps.map((step, i) => (
					<div key={step.number} className="contents">
						{i > 0 && (
							<div className="step-arrow hidden sm:flex w-10">
								<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
									<path
										d="M6 10h8M11 7l3 3-3 3"
										stroke="currentColor"
										strokeWidth="1.2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</div>
						)}
						<div className="step-card flex-1">
							<div className={`step-number ${colorMap[step.color]}`}>{step.number}</div>
							<h3 className={`text-base font-semibold mb-1 ${labelColorMap[step.color]}`}>
								{step.title}
							</h3>
							<p className="text-[13px] text-muted leading-relaxed mb-3">{step.desc}</p>
							<ul className="space-y-1">
								{step.items.map((item) => (
									<li key={item} className="flex items-center gap-2 text-[12px] text-dim">
										<span className={`w-1 h-1 rounded-full bg-${step.color} shrink-0`} />
										{item}
									</li>
								))}
							</ul>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Examples (code tabs)
   ═══════════════════════════════════════════ */

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
		<section className="mb-16 sm:mb-20">
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

/* ═══════════════════════════════════════════
   What Gets Captured
   ═══════════════════════════════════════════ */

function CapturedData() {
	const ref = useReveal();
	return (
		<section ref={ref} className="mb-16 sm:mb-20 reveal">
			<p className="section-label text-emerald before:bg-emerald">What gets captured</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Everything an LLM needs, in one click
			</h2>
			<p className="text-[13px] text-muted mb-8 max-w-2xl">
				Click an element and deloop captures its full DOM context, computed styles, React component
				hierarchy with source file locations, and a screenshot — automatically.
			</p>

			<div className="grid lg:grid-cols-2 gap-6">
				{/* Left: the readout card */}
				<div className="capture-readout">
					<div className="capture-readout-header">
						<span className="w-[6px] h-[6px] rounded-full bg-accent" />
						<span className="text-accent">Element annotation</span>
						<span className="ml-auto text-muted font-normal normal-case tracking-normal text-[11px]">
							button#submit-btn
						</span>
					</div>
					<div className="capture-readout-body space-y-4">
						<div className="capture-readout-section">
							<div className="capture-readout-label">Selectors</div>
							<div className="capture-readout-row">
								<span className="key">xpath</span>
								<span className="val text-[11px]">/html/body/div/main/form/button</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">css</span>
								<span className="val">#submit-btn</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">classes</span>
								<span className="val">.btn .btn-primary</span>
							</div>
						</div>

						<div className="capture-readout-section">
							<div className="capture-readout-label">Computed styles</div>
							<div className="capture-readout-row">
								<span className="key">background</span>
								<span className="val">
									<span className="capture-color-swatch" style={{ background: "#3b82f6" }} />
									rgb(59, 130, 246)
								</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">color</span>
								<span className="val">
									<span className="capture-color-swatch" style={{ background: "#ffffff" }} />
									rgb(255, 255, 255)
								</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">font-size</span>
								<span className="val">14px</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">padding</span>
								<span className="val">8px 16px</span>
							</div>
						</div>

						<div className="capture-readout-section">
							<div className="capture-readout-label">React component tree</div>
							<div className="text-emerald text-[12px]">App › Dashboard › OrderForm › Button</div>
							<div className="capture-readout-row mt-1">
								<span className="key">props</span>
								<span className="val text-[11px]">
									{"{ "}variant: &quot;primary&quot;, size: &quot;md&quot;{" }"}
								</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">source</span>
								<span className="val text-accent text-[11px]">src/ui/Button.tsx:6</span>
							</div>
						</div>

						<div className="capture-readout-section">
							<div className="capture-readout-label">Layout</div>
							<div className="capture-readout-row">
								<span className="key">size</span>
								<span className="val">120 × 40</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">position</span>
								<span className="val">(450, 320)</span>
							</div>
							<div className="capture-readout-row">
								<span className="key">text</span>
								<span className="val">&quot;Submit Order&quot;</span>
							</div>
						</div>
					</div>
				</div>

				{/* Right: explanation */}
				<div className="space-y-5 py-2">
					{[
						{
							color: "text-accent",
							dot: "bg-accent",
							title: "DOM selectors",
							desc: "XPath and CSS selector for every element — the most reliable way for an LLM to locate and reference specific nodes in code.",
						},
						{
							color: "text-cyan",
							dot: "bg-cyan",
							title: "Computed CSS",
							desc: "The actual rendered values, not what's in the stylesheet. Background color, font size, padding, display mode — exactly what the browser computed.",
						},
						{
							color: "text-emerald",
							dot: "bg-emerald",
							title: "React component context",
							desc: "The full component hierarchy with props and source file locations. An LLM can go directly to the file and line that renders the problematic element.",
						},
						{
							color: "text-amber",
							dot: "bg-amber",
							title: "Layout & bounding rect",
							desc: "Element dimensions, position on screen, inner text, and outer HTML — everything needed to understand the element in context.",
						},
						{
							color: "text-rose",
							dot: "bg-rose",
							title: "Context screenshot",
							desc: "A screenshot of the surrounding area is captured with every drawing annotation, so there's always visual reference alongside the structured data.",
						},
					].map((item) => (
						<div key={item.title} className="flex items-start gap-3">
							<span className={`mt-[7px] block w-1.5 h-1.5 rounded-full ${item.dot} shrink-0`} />
							<div>
								<p className={`text-sm font-medium ${item.color}`}>{item.title}</p>
								<p className="text-[13px] text-muted leading-relaxed">{item.desc}</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Before vs After
   ═══════════════════════════════════════════ */

function BeforeAfter() {
	const ref = useReveal();
	return (
		<section ref={ref} className="mb-16 sm:mb-20 reveal">
			<p className="section-label text-rose before:bg-rose">Why this matters</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Close the feedback loop
			</h2>
			<p className="text-[13px] text-muted mb-8 max-w-2xl">
				Bug reports today are broken. A screenshot in Slack, a vague ticket, three follow-ups to
				reproduce. By the time someone has enough context, the feedback is stale.
			</p>

			<div className="grid sm:grid-cols-2 gap-4">
				{/* The Old Way */}
				<div className="comparison-panel comparison-bad">
					<div className="comparison-panel-header">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="15" y1="9" x2="9" y2="15" />
							<line x1="9" y1="9" x2="15" y2="15" />
						</svg>
						The old way
					</div>
					<div className="comparison-panel-body space-y-3 text-[13px] text-muted">
						<div className="rounded-lg border border-border p-3 bg-bg-code">
							<div className="flex items-center gap-2 mb-2">
								<span className="w-5 h-5 rounded-full bg-rose/20 flex items-center justify-center text-[10px]">
									💬
								</span>
								<span className="text-[11px] text-dim font-medium">QA in #bugs</span>
							</div>
							<p className="text-muted italic">
								&quot;hey the button on the dashboard is the wrong color, can someone look at
								it?&quot;
							</p>
							<div className="mt-2 rounded border border-border bg-bg h-16 flex items-center justify-center text-[10px] text-muted/50">
								blurry-screenshot.png
							</div>
						</div>
						<div className="space-y-2 pl-4 border-l-2 border-border">
							<p className="text-[12px]">
								<span className="text-dim font-medium">Dev:</span>{" "}
								<span className="text-muted italic">&quot;Which button?&quot;</span>
							</p>
							<p className="text-[12px]">
								<span className="text-dim font-medium">QA:</span>{" "}
								<span className="text-muted italic">
									&quot;The blue one on the orders page&quot;
								</span>
							</p>
							<p className="text-[12px]">
								<span className="text-dim font-medium">Dev:</span>{" "}
								<span className="text-muted italic">
									&quot;Which orders page? There are three.&quot;
								</span>
							</p>
							<p className="text-[12px]">
								<span className="text-dim font-medium">QA:</span>{" "}
								<span className="text-muted italic">&quot;...the one with the table&quot;</span>
							</p>
						</div>
						<p className="text-[11px] text-rose/80 font-medium">
							4 messages later, still no actionable context.
						</p>
					</div>
				</div>

				{/* The Deloop Way */}
				<div className="comparison-panel comparison-good">
					<div className="comparison-panel-header">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
							<polyline points="22 4 12 14.01 9 11.01" />
						</svg>
						With deloop
					</div>
					<div className="comparison-panel-body text-[13px] text-muted font-mono">
						<div className="space-y-2 text-[11px]">
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">tag</span>
								<span className="text-fg">button#submit-btn</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">xpath</span>
								<span className="text-fg text-[10px]">/html/body/div/main/form/button</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">bg</span>
								<span className="text-fg">
									<span className="inline-block w-2 h-2 rounded-sm bg-accent mr-1 align-middle" />
									rgb(59, 130, 246)
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">react</span>
								<span className="text-emerald">App › OrderForm › Button</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">source</span>
								<span className="text-accent">src/ui/Button.tsx:6</span>
							</div>
							<div className="border-t border-border pt-2 mt-2 flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">note</span>
								<span className="text-fg font-sans">
									&quot;Color should be #10b981 per design spec&quot;
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">📷</span>
								<span className="text-dim font-sans">annotated screenshot attached</span>
							</div>
						</div>
						<p className="text-[11px] text-emerald/80 font-medium font-sans mt-3">
							One interaction. Every detail captured. Ready for an LLM or a developer.
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Integrations
   ═══════════════════════════════════════════ */

function Integrations() {
	const ref = useReveal();

	const methods = [
		{
			label: "npm package",
			color: "text-accent",
			desc: "Import the React component or call init() programmatically. Full TypeScript support.",
			code: `import { Deloop } from "deloop.dev";
<Deloop onSubmit={(p) => agent.send(p)} />`,
			lang: "tsx",
		},
		{
			label: "CDN script tag",
			color: "text-emerald",
			desc: "One tag, zero build step. Works on WordPress, Shopify, static HTML — anything.",
			code: `<script src="https://unpkg.com/deloop.dev/cdn"></script>
<script>window.Deloop.init();</script>`,
			lang: "html",
		},
		{
			label: "Chrome extension",
			color: "text-amber",
			desc: "Use on any website without modifying source — staging, competitors, third-party tools.",
			code: `// No code needed — install from Chrome Web Store
// Works on any tab, any domain`,
			lang: "typescript",
		},
		{
			label: "Webhook",
			color: "text-cyan",
			desc: "POST structured payloads to any URL. Connect to Slack, Linear, Jira, or your own pipeline.",
			code: `<Deloop server="https://api.yourapp.com/bugs" />
// or via init({ server: "..." })`,
			lang: "tsx",
		},
	];

	return (
		<section ref={ref} className="mb-16 sm:mb-20 reveal">
			<p className="section-label text-amber before:bg-amber">Integration</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Add it anywhere in under a minute
			</h2>
			<p className="text-[13px] text-muted mb-8 max-w-2xl">
				Four ways to add deloop to any project. React component, CDN tag, Chrome extension, or
				programmatic init — pick what fits your stack.
			</p>

			<div className="grid sm:grid-cols-2 gap-4">
				{methods.map((m) => (
					<div key={m.label} className="integration-card">
						<p className={`text-sm font-semibold ${m.color} mb-1`}>{m.label}</p>
						<p className="text-[13px] text-muted leading-relaxed mb-3">{m.desc}</p>
						<CodeBlock lang={m.lang} code={m.code} />
					</div>
				))}
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Pipelines & Webhooks
   ═══════════════════════════════════════════ */

function Pipelines() {
	const ref = useReveal();

	const pipelines = [
		{
			name: "Slack",
			color: "text-amber",
			dot: "bg-amber",
			desc: "Post structured bug reports to any Slack channel. The webhook receives the full payload — format it however you want.",
			code: `// Your webhook endpoint
app.post("/api/deloop", async (req) => {
  const { prompt, annotations } = req.body;
  await slack.chat.postMessage({
    channel: "#bugs",
    text: prompt, // formatted Markdown
  });
});`,
			lang: "typescript",
		},
		{
			name: "GitHub Issues",
			color: "text-fg",
			dot: "bg-fg",
			desc: "Auto-create GitHub issues with the full annotation context, labels, and screenshots attached.",
			code: `app.post("/api/deloop", async (req) => {
  const { prompt, annotations, label } = req.body;
  await octokit.issues.create({
    owner: "org", repo: "app",
    title: \`Bug: \${label || "Untitled"}\`,
    body: prompt,
    labels: ["bug", "deloop"],
  });
});`,
			lang: "typescript",
		},
		{
			name: "Jira",
			color: "text-accent",
			dot: "bg-accent",
			desc: "Create Jira tickets with structured reproduction steps. XPaths and component paths go right into the description.",
			code: `app.post("/api/deloop", async (req) => {
  const { prompt, url, annotations } = req.body;
  await jira.addNewIssue({
    fields: {
      project: { key: "APP" },
      issuetype: { name: "Bug" },
      summary: \`Visual issue on \${url}\`,
      description: prompt,
    },
  });
});`,
			lang: "typescript",
		},
		{
			name: "Linear",
			color: "text-cyan",
			dot: "bg-cyan",
			desc: "Push annotated issues directly into Linear with team assignment, priority, and full context.",
			code: `app.post("/api/deloop", async (req) => {
  const { prompt, label } = req.body;
  await linear.createIssue({
    teamId: "...",
    title: label || "Visual bug report",
    description: prompt,
    priority: 2,
  });
});`,
			lang: "typescript",
		},
	];

	return (
		<section ref={ref} className="mb-16 sm:mb-20 reveal">
			<p className="section-label text-rose before:bg-rose">Pipelines</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Connect to anything with webhooks
			</h2>
			<p className="text-[13px] text-muted mb-3 max-w-2xl">
				Set a{" "}
				<code className="text-fg font-mono text-[12px] bg-bg-code px-1.5 py-0.5 rounded">
					server
				</code>{" "}
				URL and deloop POSTs the full structured payload on every export. Write a small handler to
				route it wherever your team works — Slack, Jira, GitHub, Linear, or your own custom
				pipeline.
			</p>
			<div className="flex items-center gap-2 mb-8">
				<CodeBlock lang="tsx" code={`<Deloop server="https://api.yourapp.com/deloop" />`} />
			</div>

			<div className="grid sm:grid-cols-2 gap-4">
				{pipelines.map((p) => (
					<div key={p.name} className="integration-card">
						<div className="flex items-center gap-2.5 mb-1">
							<span className={`block w-2 h-2 rounded-full ${p.dot} shrink-0`} />
							<p className={`text-sm font-semibold ${p.color}`}>{p.name}</p>
						</div>
						<p className="text-[13px] text-muted leading-relaxed mb-3">{p.desc}</p>
						<CodeBlock lang={p.lang} code={p.code} />
					</div>
				))}
			</div>

			<div className="mt-6 border border-border rounded-xl p-5 bg-bg-card">
				<h3 className="text-sm font-semibold text-fg mb-2">Fully customizable with onSubmit</h3>
				<p className="text-[13px] text-muted leading-relaxed mb-3">
					For complete control, use the{" "}
					<code className="text-fg font-mono text-[12px] bg-bg-code px-1.5 py-0.5 rounded">
						onSubmit
					</code>{" "}
					callback instead of a server URL. You receive the full typed payload and can do anything —
					chain multiple services, transform the data, run it through your own AI pipeline, or
					conditionally route based on labels.
				</p>
				<CodeBlock
					lang="tsx"
					code={`<Deloop
  onSubmit={async (payload) => {
    // payload.prompt — formatted Markdown string
    // payload.annotations — full structured array
    // payload.label — optional label from the toolbar
    // payload.url, payload.viewport, payload.userAgent, ...

    // Send to multiple services
    await Promise.all([
      postToSlack(payload.prompt),
      createGitHubIssue(payload),
      notifyTeam(payload.label, payload.url),
    ]);
  }}
/>`}
				/>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Use Cases
   ═══════════════════════════════════════════ */

function UseCases() {
	const ref = useReveal();
	const roles = [
		{
			color: "bg-emerald",
			colorText: "text-emerald",
			role: "Local development",
			desc: "Wire onSubmit or a webhook to your AI agent. See a bug, annotate it, and the structured context goes directly to Claude, Cursor, or your own pipeline — no copy-paste, no context switching.",
			detail:
				"The React component tree and source file paths let the LLM jump directly to the code that needs fixing.",
		},
		{
			color: "bg-accent",
			colorText: "text-accent",
			role: "Designers",
			desc: "Spot a spacing issue, select the element, and submit. The report includes the exact CSS values, bounding rect, and component source — so developers fix the right thing on the first try.",
			detail:
				"Computed styles show what the browser actually renders, not what's in the stylesheet — catching cascade and override bugs.",
		},
		{
			color: "bg-cyan",
			colorText: "text-cyan",
			role: "QA & Reviewers",
			desc: 'Annotate bugs with markers, drawings, and screenshots in context. Every report is structured and reproducible — no more guesswork, no more "works on my machine."',
			detail:
				"Page URL, viewport dimensions, and user agent are captured automatically — instant reproduction context.",
		},
		{
			color: "bg-amber",
			colorText: "text-amber",
			role: "Product Managers",
			desc: "Give feedback directly on staging without leaving the browser. The toolbar captures everything a developer needs — no follow-up questions, no lost context.",
			detail:
				"Comments on annotations add narrative context that structured data alone can't provide.",
		},
	];

	return (
		<section ref={ref} className="mb-16 sm:mb-20 reveal">
			<p className="section-label text-cyan before:bg-cyan">Use cases</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Built for every role in the iteration loop
			</h2>
			<p className="text-[13px] text-muted mb-6 max-w-2xl">
				Whether you&apos;re a solo developer feeding annotations to your AI agent or a team
				coordinating across design, QA, and engineering — deloop captures the context that closes
				the gap between spotting a bug and shipping the fix.
			</p>
			<div className="grid sm:grid-cols-2 gap-5">
				{roles.map((r) => (
					<div
						key={r.role}
						className="border border-border rounded-lg p-5 hover:border-muted transition-colors"
					>
						<div className="flex items-center gap-2.5 mb-2">
							<span className={`block w-2 h-2 rounded-full ${r.color} shrink-0`} />
							<p className={`text-sm font-semibold ${r.colorText}`}>{r.role}</p>
						</div>
						<p className="text-[13px] text-muted leading-relaxed mb-2">{r.desc}</p>
						<p className="text-[12px] text-dim leading-relaxed">{r.detail}</p>
					</div>
				))}
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Features
   ═══════════════════════════════════════════ */

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
		<section ref={ref} className="mb-16 sm:mb-20 reveal">
			<p className="section-label text-accent before:bg-accent">Features</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Everything captured, nothing lost
			</h2>
			<p className="text-[13px] text-muted mb-6 max-w-2xl">
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

/* ═══════════════════════════════════════════
   Pricing
   ═══════════════════════════════════════════ */

function Pricing() {
	const ref = useReveal();
	return (
		<section ref={ref} id="pricing" className="mb-16 sm:mb-20 scroll-mt-20 reveal">
			<p className="section-label text-emerald before:bg-emerald">Pricing</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
				Simple pricing
			</h2>
			<p className="text-[13px] text-muted mb-6 max-w-2xl">
				Self-host for free with every feature included. Or use the hosted version for team
				dashboards and report history.
			</p>
			<PricingCards />
		</section>
	);
}

/* ═══════════════════════════════════════════
   CodeBlock
   ═══════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════
   FAQ
   ═══════════════════════════════════════════ */

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
		<section ref={ref} id="faq" className="mb-16 sm:mb-20 scroll-mt-20 reveal">
			<p className="section-label text-cyan before:bg-cyan">FAQ</p>
			<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-6">
				Frequently asked questions
			</h2>
			<div className="grid sm:grid-cols-2 gap-x-16 gap-y-5">
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

/* ═══════════════════════════════════════════
   Contact
   ═══════════════════════════════════════════ */

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
		<section ref={ref} id="contact" className="mb-16 sm:mb-20 scroll-mt-20 reveal">
			<div className="grid sm:grid-cols-2 gap-6 items-start">
				{/* Left: copy */}
				<div>
					<p className="section-label text-accent before:bg-accent">Contact</p>
					<h2 className="text-xl sm:text-2xl font-bold text-fg tracking-[-0.02em] mb-2">
						Get in touch
					</h2>
					<p className="text-[13px] text-muted leading-relaxed mb-5 max-w-sm">
						Have a question, feature request, or just want to say hi? We&apos;d love to hear from
						you.
					</p>
					<div className="space-y-3">
						<a
							href="https://github.com/TimMikeladze/deloop/issues"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-3 text-[13px] text-muted hover:text-fg transition-colors group"
						>
							<span className="w-8 h-8 rounded-lg border border-border bg-bg-card flex items-center justify-center shrink-0 group-hover:border-muted transition-colors">
								<svg
									width="14"
									height="14"
									viewBox="0 0 16 16"
									fill="currentColor"
									className="text-dim"
								>
									<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
								</svg>
							</span>
							<span>
								<span className="text-fg font-medium block">Open an issue</span>
								<span className="text-[12px]">Bug reports &amp; feature requests on GitHub</span>
							</span>
						</a>
						<a
							href="https://x.com/linesofcode"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-3 text-[13px] text-muted hover:text-fg transition-colors group"
						>
							<span className="w-8 h-8 rounded-lg border border-border bg-bg-card flex items-center justify-center shrink-0 group-hover:border-muted transition-colors">
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="currentColor"
									className="text-dim"
								>
									<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
								</svg>
							</span>
							<span>
								<span className="text-fg font-medium block">@linesofcode</span>
								<span className="text-[12px]">DMs open on X</span>
							</span>
						</a>
					</div>
				</div>

				{/* Right: form in a card */}
				<div className="border border-border rounded-xl bg-bg-card overflow-hidden">
					<div className="px-5 py-3 border-b border-border flex items-center gap-2">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-muted"
						>
							<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
							<polyline points="22,6 12,13 2,6" />
						</svg>
						<span className="text-[12px] font-medium text-muted">Send a message</span>
					</div>
					<form onSubmit={handleSubmit} className="p-5 space-y-3">
						<div>
							<label
								htmlFor="contact-email"
								className="block text-[11px] font-medium text-muted uppercase tracking-wider mb-1.5"
							>
								Email
							</label>
							<input
								id="contact-email"
								name="email"
								type="email"
								required
								placeholder="you@company.com"
								className="w-full rounded-lg border border-border bg-bg-code px-3 py-2 text-[13px] text-fg placeholder:text-muted/40 outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all"
							/>
						</div>
						<div>
							<label
								htmlFor="contact-message"
								className="block text-[11px] font-medium text-muted uppercase tracking-wider mb-1.5"
							>
								Message
							</label>
							<textarea
								id="contact-message"
								name="message"
								required
								rows={4}
								placeholder="What's on your mind?"
								className="w-full rounded-lg border border-border bg-bg-code px-3 py-2 text-[13px] text-fg placeholder:text-muted/40 outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-all resize-y"
							/>
						</div>
						<div className="flex items-center gap-3 pt-1">
							<button
								type="submit"
								disabled={status === "sending" || status === "sent"}
								className="inline-flex items-center gap-2 text-bg bg-fg rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-fg/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
							>
								{status === "sending" ? (
									<>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className="animate-spin"
										>
											<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
										</svg>
										Sending...
									</>
								) : status === "sent" ? (
									<>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<polyline points="20 6 9 17 4 12" />
										</svg>
										Sent
									</>
								) : (
									<>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<line x1="22" y1="2" x2="11" y2="13" />
											<polygon points="22 2 15 22 11 13 2 9 22 2" />
										</svg>
										Send message
									</>
								)}
							</button>
							{status === "sent" && (
								<span className="text-emerald text-[12px]">
									Thanks! We&apos;ll get back to you soon.
								</span>
							)}
							{status === "error" && (
								<span className="text-rose text-[12px]">Something went wrong. Try again.</span>
							)}
						</div>
					</form>
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════ */

const footerLinks = [
	{
		href: "https://github.com/TimMikeladze/deloop",
		label: "GitHub",
		icon: (
			<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
				<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
			</svg>
		),
	},
	{
		href: "https://www.npmjs.com/package/deloop.dev",
		label: "npm",
		icon: (
			<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
				<path d="M0 0v16h16V0H0zm13 13H8V5h2.5v5.5H13V5h-1.5V3H3v10h10v-3z" />
			</svg>
		),
	},
	{
		href: "https://github.com/TimMikeladze/deloop/releases",
		label: "Releases",
		icon: (
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
		),
	},
	{ sep: true },
	{
		href: "https://x.com/linesofcode",
		label: "X",
		icon: (
			<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
				<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
			</svg>
		),
	},
	{
		href: "https://bsky.app/profile/linesofcode.bsky.social",
		label: "Bluesky",
		icon: (
			<svg width="14" height="14" viewBox="0 0 568 501" fill="currentColor">
				<path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32 353.473 576.312 301.061 422.461 287.631 383.039c-2.458-7.22-3.503-10.581-3.631-7.734-.128-2.847-1.173.514-3.631 7.734-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.89-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.659 0 75.291 0 57.946 0-28.906 76.135-1.612 123.121 33.664z" />
			</svg>
		),
	},
] as const;

function FooterLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1.5 text-muted hover:text-fg transition-colors"
		>
			{icon}
			{label}
		</a>
	);
}

function Footer() {
	return (
		<footer className="border-t border-border pt-8 mt-4 pb-8">
			<div className="flex flex-wrap items-center gap-5 text-[13px]">
				{footerLinks.map((link, i) =>
					"sep" in link ? (
						<span key={i} className="w-px h-3.5 bg-border" />
					) : (
						<FooterLink key={link.href} href={link.href} label={link.label} icon={link.icon} />
					),
				)}
				<span className="ml-auto text-muted/30 text-xs">
					&copy; {new Date().getFullYear()} deloop.dev
				</span>
			</div>
		</footer>
	);
}

export default App;
