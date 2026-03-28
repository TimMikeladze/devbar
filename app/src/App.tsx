import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { createHighlighter, type Highlighter } from "shiki";
import { Deloop } from "deloop.dev";
import "deloop.dev/styles.css";
import { PricingCards } from "./components/PricingCards";
import { useTheme, type Theme } from "./hooks/useTheme";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-dark-default", "github-light-default"],
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
		// Fallback: if IntersectionObserver never fires (e.g. polyfill edge case),
		// reveal after 1s so content is never permanently hidden
		const fallback = setTimeout(() => {
			if (!el.classList.contains("visible")) {
				el.classList.add("visible");
			}
		}, 1000);
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					clearTimeout(fallback);
					el.classList.add("visible");
					observer.disconnect();
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(el);
		return () => {
			clearTimeout(fallback);
			observer.disconnect();
		};
	}, []);
	return ref;
}

function App() {
	return (
		<div className="min-h-screen hero-glow">
			<Header />
			<main className="max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-24 pb-10">
				<Hero />
				<BeforeAfter />
				<HowItWorks />
				<Examples />
				<UseCases />
				<CapturedData />
				<Integrations />
				<Pipelines />
				<Features />
				<Pricing />
				<PremiumFeatures />
				<FAQ />
				<Contact />
				<Footer />
			</main>
		</div>
	);
}

/* ═══════════════════════════════════════════
   Header
   ═══════════════════════════════════════════ */

function Header() {
	const [open, setOpen] = useState(false);
	const { theme, setTheme } = useTheme();
	const cycle = useCallback(() => {
		setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
	}, [theme, setTheme]);

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
			<div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
				<a href="/" className="text-fg font-semibold tracking-tight text-[15px]">
					deloop.dev
				</a>

				<nav className="hidden sm:flex items-center gap-6 text-[13px]">
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
					<ThemeToggle theme={theme} onCycle={cycle} />
					<Link to="/login" className="text-fg hover:text-fg/80 transition-colors font-medium">
						Sign In
					</Link>
					<Link to="/login?signup=1" className="btn-warm text-[13px] !py-1.5 !px-4">
						Get Started
					</Link>
				</nav>

				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="sm:hidden flex flex-col gap-[5px] p-2 -mr-2 cursor-pointer"
					aria-label="Toggle menu"
					aria-expanded={open}
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
						<ThemeToggle theme={theme} onCycle={cycle} />
						<Link to="/login" className="text-[14px] text-fg font-medium">
							Sign In
						</Link>
						<Link to="/login?signup=1" className="btn-warm text-[13px] !py-1.5 !px-4">
							Get Started
						</Link>
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
	useEffect(() => {
		// Add shine border to the deloop toolbar bar on mount, dismiss on first click
		let barRef: Element | null = null;
		let dismissRef: (() => void) | null = null;
		const interval = setInterval(() => {
			const bar = document.querySelector(".deloop-bar");
			if (!bar) return;
			clearInterval(interval);
			barRef = bar;
			bar.classList.add("deloop-shine");
			const dismiss = () => {
				bar.classList.remove("deloop-shine");
				bar.removeEventListener("click", dismiss);
				dismissRef = null;
			};
			dismissRef = dismiss;
			bar.addEventListener("click", dismiss);
		}, 100);
		return () => {
			clearInterval(interval);
			if (barRef && dismissRef) {
				barRef.removeEventListener("click", dismissRef);
				barRef.classList.remove("deloop-shine");
			}
		};
	}, []);

	return (
		<section className="mb-24 sm:mb-32 pt-4 sm:pt-8">
			<div className="hero-frame px-6 py-12 sm:px-12 sm:py-16 lg:px-16 lg:py-20">
				<div className="hero-frame-glow" />
				<div className="hero-stagger relative text-center max-w-4xl mx-auto">
					<p className="text-[13px] sm:text-sm font-medium tracking-widest uppercase text-muted mb-4">
						Open&#8209;source&nbsp;·&nbsp;MIT&nbsp;licensed
					</p>
					<h1 className="text-[2.5rem] sm:text-[3.5rem] lg:text-[4.5rem] font-bold tracking-[-0.03em] leading-[1.08] mb-6">
						<span className="font-display italic text-[2.8rem] sm:text-[4rem] lg:text-[5rem] tracking-[-0.02em]">
							Close the loop.
						</span>{" "}
						<span className="gradient-warm">Ship faster.</span>
					</h1>
					<p className="text-dim text-[15px] sm:text-lg leading-[1.7] mb-8 max-w-2xl mx-auto">
						An open&#8209;source toolbar that captures structured context from any website. Click an
						element, draw on it, drop a marker, add a comment — deloop extracts selectors, styles,
						and source paths. Send that context to your AI agent, share it with your team, or both.
					</p>
					<div className="max-w-sm mx-auto mb-6">
						<InstallTabs />
					</div>
					<div className="flex items-center justify-center gap-4">
						<a href="#how-it-works" className="btn-warm">
							Get started — it's free
						</a>
						<a
							href="https://github.com/TimMikeladze/deloop"
							target="_blank"
							rel="noopener noreferrer"
							className="text-[14px] text-muted hover:text-fg transition-colors font-medium"
						>
							View on GitHub &rarr;
						</a>
					</div>
				</div>
			</div>

			{/* Real Deloop toolbar — rendered here, floats freely via position:fixed */}
			<Deloop />
		</section>
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
			desc: "Anyone spots something — click it, circle it, draw on it, or drop a marker. Designers, QA, PMs, and developers all use the same toolbar. No DevTools knowledge needed.",
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
			title: "Context",
			color: "emerald",
			desc: "deloop auto-captures XPaths, CSS selectors, computed styles, React component trees, and source file paths behind every click. A designer's annotation carries the same structured context a developer or AI agent needs to act.",
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
			title: "Route",
			color: "cyan",
			desc: "Send structured context wherever it needs to go — paste into Claude or Cursor, share with your team on the dashboard, pipe to an agent via MCP, or push to Slack, Jira, and Linear. Same payload, every destination.",
			items: [
				"Paste into any LLM or coding assistant",
				"Shared team dashboard",
				"MCP server for agent workflows",
				"Webhook to Slack, Jira, Linear",
				"JSON & Markdown export",
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

	return (
		<section
			ref={ref}
			id="how-it-works"
			className="mb-24 sm:mb-32 scroll-mt-20 reveal section-tint"
		>
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-amber before:bg-amber justify-center">How it works</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Annotate. Capture context. <span className="gradient-warm">Route it anywhere.</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					Anyone on your team spots an issue. deloop turns their annotation into structured context
					that flows to your AI agent, your teammates, or both — no translation layer needed.
				</p>
			</div>

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
			desc: "One component. Every annotation becomes structured context your agent or teammates can act on.",
		},
		{
			label: "Script tag",
			color: "bg-cyan",
			title: "Script tag",
			desc: "No build step. Drop it on any HTML page and start capturing context for your team.",
		},
		{
			label: "Vanilla",
			color: "bg-amber",
			title: "Vanilla JS",
			desc: "Programmatic init for any JavaScript app. Full control over where context flows.",
		},
		{
			label: "Markdown",
			color: "bg-emerald",
			title: "Markdown output",
			desc: "Structured context copied to clipboard — paste into Claude, Cursor, ChatGPT, or share with your team.",
		},
		{
			label: "JSON",
			color: "bg-rose",
			title: "JSON output",
			desc: "The full structured payload — POST to a webhook, pipe to an agent via MCP, or share on the team dashboard.",
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
		<section className="mb-24 sm:mb-32">
			<div className="flex items-center gap-1 mb-3 overflow-x-auto tabs-scroll pb-1 -mx-5 px-5 sm:mx-0 sm:px-0">
				{tabs.map((t, i) => (
					<button
						key={t.label}
						onClick={() => setTab(i)}
						className={`inline-flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
							tab === i ? "text-fg bg-fg/[0.06]" : "text-muted hover:text-dim"
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
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-emerald before:bg-emerald justify-center">
					What gets captured
				</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Rich context, <span className="gradient-warm">zero follow-ups</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					Every annotation automatically produces structured context — DOM selectors, computed
					styles, React component trees, source file paths, and screenshots. Whether a designer
					filed it or QA did, your AI agent and your developers both get exactly what they need to
					act.
				</p>
			</div>

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
							desc: "XPath and CSS selector for every annotated element. Your agent uses them to locate the exact node. Your teammate uses them to verify the fix.",
						},
						{
							color: "text-cyan",
							dot: "bg-cyan",
							title: "Computed CSS",
							desc: 'Actual rendered values, not what\'s in the stylesheet. Designers, developers, and agents all see the same precise colors and spacing — no "it looks different on my screen."',
						},
						{
							color: "text-emerald",
							dot: "bg-emerald",
							title: "React component context",
							desc: "Full component hierarchy with props and source file locations. A designer files the annotation — your agent or developer goes straight to the right file and line.",
						},
						{
							color: "text-amber",
							dot: "bg-amber",
							title: "Layout & bounding rect",
							desc: "Element dimensions, position, inner text, and outer HTML. Enough spatial context for an agent to reason about layout or a teammate to review the design.",
						},
						{
							color: "text-rose",
							dot: "bg-rose",
							title: "Context screenshot",
							desc: "Visual reference captured with every annotation. Your agent sees what the reporter saw. Your teammate sees what the reporter saw. No ambiguity.",
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
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-rose before:bg-rose justify-center">The problem</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Without context, <span className="gradient-warm">nobody can act</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					A designer posts a screenshot with no element info. A PM writes &ldquo;the button on that
					page.&rdquo; Your AI agent asks which element you mean. Every handoff — teammate to
					developer, developer to agent — loses context. Three follow-ups later, nothing ships.
				</p>
			</div>

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
							strokeWidth="3"
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
								screenshot.png
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
							4 messages. 20 minutes. Your teammate can&apos;t fix it. Your agent can&apos;t fix it.
							Nobody has context.
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
							strokeWidth="3"
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
							One click. Structured context. Paste it into Claude, share it with your team, or pipe
							it to an agent.
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
			desc: "Import the React component or call init() programmatically. Context flows to your agent, your team, or both.",
			code: `import { Deloop } from "deloop.dev";
<Deloop onSubmit={(p) => agent.send(p)} />`,
			lang: "tsx",
		},
		{
			label: "CDN script tag",
			color: "text-emerald",
			desc: "One tag, zero build step. Anyone on the team can start capturing context immediately.",
			code: `<script src="https://unpkg.com/deloop.dev/cdn"></script>
<script>window.Deloop.init();</script>`,
			lang: "html",
		},
		{
			label: "Webhook / MCP",
			color: "text-cyan",
			desc: "POST structured context to any URL, or expose annotations via MCP so your agent can pull them directly.",
			code: `<Deloop server="https://api.yourapp.com/bugs" />
// or via init({ server: "..." })`,
			lang: "tsx",
		},
	];

	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-amber before:bg-amber justify-center">Integration</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Add it once, <span className="gradient-warm">context flows everywhere</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					React component, CDN tag, or programmatic init. One integration gives every collaborator —
					teammates and AI agents alike — the same structured context surface.
				</p>
			</div>

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
			desc: "Post structured context to any Slack channel so the whole team sees it. The webhook receives the full payload — format it however you want.",
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
			desc: "Auto-create GitHub issues with full structured context — selectors, component paths, and screenshots. Your agent or teammate picks it up and acts.",
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
			desc: "Create Jira tickets with structured context — XPaths, component paths, and source locations go right into the description. No manual reproduction steps.",
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
			desc: "Push structured context directly into Linear with team assignment and priority. Everyone on the team — and your agent — works from the same data.",
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
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-rose before:bg-rose justify-center">Pipelines</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Send context <span className="gradient-warm">to every tool your team uses</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					Set a{" "}
					<code className="text-fg font-mono text-[12px] bg-bg-code px-1.5 py-0.5 rounded">
						server
					</code>{" "}
					URL and deloop POSTs the full structured context on every export — to your agent, your
					issue tracker, or both.
				</p>
			</div>

			<div className="max-w-xl mx-auto mb-8">
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
					callback instead of a server URL. You receive the full typed payload and can route context
					to every collaborator simultaneously — notify your team on Slack, create an issue in
					Linear, and feed the same structured data into your AI agent, all in one call.
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
	const soloUses = [
		{
			color: "bg-accent",
			colorText: "text-accent",
			role: "Developer + AI agent",
			desc: "Send your agent the context it actually needs. Annotate what's wrong, hit export, and structured context — XPaths, component trees, source file paths — lands in Claude, Cursor, or ChatGPT. Your agent opens the right file and ships the fix.",
		},
		{
			color: "bg-emerald",
			colorText: "text-emerald",
			role: "Self-review & iteration",
			desc: "Review your own work in the browser and annotate what needs to change. deloop captures exact CSS values, bounding rects, and screenshots — fix it yourself or hand the structured context to your agent.",
		},
		{
			color: "bg-cyan",
			colorText: "text-cyan",
			role: "Agent pipelines via MCP",
			desc: "Wire deloop into your agent via MCP, a webhook, or onSubmit callback. Anyone on the team annotates an issue — your agent receives structured context with source file locations and acts on it automatically.",
		},
	];

	const teamUses = [
		{
			color: "bg-amber",
			colorText: "text-amber",
			role: "Design feedback & handoff",
			desc: "Designers annotate what needs to change — deloop captures exact CSS values, bounding rects, and screenshots automatically. The developer or agent receives precise context, not a vague Slack message. One annotation replaces three follow-ups.",
		},
		{
			color: "bg-rose",
			colorText: "text-rose",
			role: "QA & stakeholder review",
			desc: "QA files structured reports. PMs review staging in the browser. Everyone's feedback arrives as the same structured context — developers and agents can act immediately, no re-explanation needed.",
		},
		{
			color: "bg-fg",
			colorText: "text-fg",
			role: "Shared dashboard & history",
			desc: "Every annotation flows to the team dashboard — one searchable history of structured context across your entire team. Traceable, filterable, and ready for any collaborator to pick up.",
		},
	];

	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal section-tint">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-cyan before:bg-cyan justify-center">
					Built for collaboration
				</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Your agent and your team, <span className="gradient-warm">same context</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					Designers annotate. QA files reports. PMs review staging. Developers paste into Claude.
					Everyone uses the same toolbar, and every annotation produces the same structured context
					— ready for a human collaborator or an AI agent to act on.
				</p>
			</div>

			<div className="grid sm:grid-cols-2 gap-6">
				{/* Solo column */}
				<div>
					<p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-accent mb-4 flex items-center gap-2">
						<span className="block w-3 h-[1.5px] bg-accent" />
						You &amp; your AI
					</p>
					<div className="space-y-4">
						{soloUses.map((r) => (
							<div
								key={r.role}
								className="border border-border rounded-lg p-5 hover:border-muted transition-colors"
							>
								<div className="flex items-center gap-2.5 mb-2">
									<span className={`block w-2 h-2 rounded-full ${r.color} shrink-0`} />
									<p className={`text-sm font-semibold ${r.colorText}`}>{r.role}</p>
								</div>
								<p className="text-[13px] text-muted leading-relaxed">{r.desc}</p>
							</div>
						))}
					</div>
				</div>

				{/* Team column */}
				<div>
					<p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-amber mb-4 flex items-center gap-2">
						<span className="block w-3 h-[1.5px] bg-amber" />
						Your whole team
					</p>
					<div className="space-y-4">
						{teamUses.map((r) => (
							<div
								key={r.role}
								className="border border-border rounded-lg p-5 hover:border-muted transition-colors"
							>
								<div className="flex items-center gap-2.5 mb-2">
									<span className={`block w-2 h-2 rounded-full ${r.color} shrink-0`} />
									<p className={`text-sm font-semibold ${r.colorText}`}>{r.role}</p>
								</div>
								<p className="text-[13px] text-muted leading-relaxed">{r.desc}</p>
							</div>
						))}
					</div>
				</div>
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
			desc: "Click any element to capture its XPath, CSS selector, computed styles, bounding rect, and HTML. Your agent locates the exact node. Your teammate verifies the fix",
		},
		{
			color: "bg-cyan",
			label: "React context extraction",
			desc: "Walks the React fiber tree to capture full component hierarchy, props, and source file locations. An agent can open the right file; a teammate can trace the component path",
		},
		{
			color: "bg-emerald",
			label: "Freehand drawing",
			desc: "Circle a problem, underline text, or sketch the expected layout. Each drawing includes a context screenshot — visual context for teammates and agents alike",
		},
		{
			color: "bg-amber",
			label: "Screenshot capture",
			desc: "Capture the full page or drag to select a region. Embed in the structured context as base64 so agents see what you see, or share as separate files with your team",
		},
		{
			color: "bg-rose",
			label: "Numbered markers",
			desc: "Drop numbered pins to call out specific areas. Each marker auto-detects the nearest DOM element and includes its XPath and CSS selector in the context payload",
		},
		{
			color: "bg-cyan",
			label: "Comments & threads",
			desc: "Add notes to any annotation — explain what's wrong or what you expect. Comments travel with the structured context so every collaborator gets the full picture",
		},
		{
			color: "bg-emerald",
			label: "Structured Markdown export",
			desc: "One-click export as Markdown — paste into Claude, Cursor, or ChatGPT, or share with your team. Page URL, viewport, and every annotation included",
		},
		{
			color: "bg-accent",
			label: "JSON & file export",
			desc: "Download the full structured context as JSON or Markdown. Feed it to an agent pipeline, attach it to a ticket, or archive it on the team dashboard",
		},
		{
			color: "bg-amber",
			label: "MCP, webhooks & clipboard",
			desc: "Route context to agents via MCP, POST to any webhook for team workflows, or copy to clipboard for instant sharing with a teammate or LLM",
		},
		{
			color: "bg-rose",
			label: "Custom prompt templates",
			desc: "Shape exactly what gets exported. Pass a template function that formats context for your agent pipeline or your team's review workflow",
		},
		{
			color: "bg-emerald",
			label: "CDN script tag",
			desc: "One script tag, zero build step. Works on any HTML page — WordPress, Shopify, static sites. Your whole team can start capturing context immediately",
		},
		{
			color: "bg-accent",
			label: "Plugin system",
			desc: "Extend the toolbar with custom tools, panels, and buttons. Build the exact context-capture workflow your team and agents need",
		},
		{
			color: "bg-amber",
			label: "Theme & positioning",
			desc: "Light, dark, or auto theme. Place the toolbar in any corner. Draggable and minimizable — stays out of the way until someone needs to capture context",
		},
	];

	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal section-tint">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-accent before:bg-accent justify-center">Features</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Every tool captures <span className="gradient-warm">actionable context</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					Every annotation automatically captures structured context so whoever acts on it — your AI
					agent, a teammate, or a reviewer — has everything they need on the first try.
				</p>
			</div>
			<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-5">
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
		<section ref={ref} id="pricing" className="mb-24 sm:mb-32 scroll-mt-20 reveal">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-emerald before:bg-emerald justify-center">Pricing</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Capture context. <span className="gradient-warm">Free.</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					Every context-capture feature — annotations, agent integrations, MCP, webhooks — is free
					and open source. When your team needs shared history, search, and org-wide settings, add
					the hosted dashboard.
				</p>
			</div>
			<PricingCards
				onSelectTeam={() => {
					window.location.href = "/login?signup=1";
				}}
				onSelectOrg={() => {
					window.location.href = "/login?signup=1";
				}}
			/>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Premium Features (after pricing)
   ═══════════════════════════════════════════ */

const premiumFeatures: {
	title: string;
	desc: string;
	color: string;
	iconBg: string;
	span?: boolean;
	icon: React.ReactNode;
}[] = [
	{
		title: "Cloud Dashboard",
		desc: "A dedicated app for your team's captured context. Browse, filter, and search every report — organized by project, date, and member. No more digging through Slack threads or stale screenshots.",
		color: "text-accent",
		iconBg: "bg-accent/10",
		span: true,
		icon: (
			<svg width="22" height="22" viewBox="0 0 20 20" fill="none">
				<rect x="2" y="3" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
				<path d="M7 18h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				<path d="M10 15v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			</svg>
		),
	},
	{
		title: "Real-time Collaboration",
		desc: "Multiple teammates annotate the same page simultaneously. See live cursors, shared markers, and threaded comments updating in real time — no refresh, no conflicts.",
		color: "text-cyan",
		iconBg: "bg-cyan/10",
		span: true,
		icon: (
			<svg width="22" height="22" viewBox="0 0 20 20" fill="none">
				<circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
				<circle cx="13" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
				<path
					d="M2 16c0-2.5 2-4 5-4s5 1.5 5 4"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
				<path
					d="M14 12c2 0 4 1.2 4 3.5"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			</svg>
		),
	},
	{
		title: "Report History & Search",
		desc: "Full-text search across every captured context your team has created. Filter by project, member, date range, or annotation type. Surface patterns your team would otherwise miss.",
		color: "text-emerald",
		iconBg: "bg-emerald/10",
		icon: (
			<svg width="22" height="22" viewBox="0 0 20 20" fill="none">
				<circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.5" />
				<path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				<path d="M7 7h4M7 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			</svg>
		),
	},
	{
		title: "Org-level Settings",
		desc: "Define prompt templates, webhook destinations, export formats, and toolbar defaults once — applied across every project and member in your organization.",
		color: "text-amber",
		iconBg: "bg-amber/10",
		icon: (
			<svg width="22" height="22" viewBox="0 0 20 20" fill="none">
				<circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
				<path
					d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			</svg>
		),
	},
];

function PremiumFeatures() {
	const ref = useReveal();
	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal section-tint">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-amber before:bg-amber justify-center">Premium</p>
				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Built for teams that <span className="gradient-warm">ship together</span>
				</h2>
				<p className="text-[14px] sm:text-[15px] text-muted max-w-2xl mx-auto">
					The free toolbar captures everything. The premium dashboard turns that context into a
					shared source of truth — searchable, collaborative, and always up to date.
				</p>
			</div>
			<div className="grid sm:grid-cols-2 gap-4">
				{premiumFeatures.map((f) => (
					<div
						key={f.title}
						className={`premium-card group border border-border rounded-xl bg-bg-card overflow-hidden ${f.span ? "lg:col-span-1" : ""}`}
					>
						<div className="p-6">
							<div className="flex items-start gap-4">
								<div
									className={`w-10 h-10 rounded-xl ${f.iconBg} ${f.color} flex items-center justify-center shrink-0`}
								>
									{f.icon}
								</div>
								<div className="min-w-0">
									<p className="text-[15px] font-semibold text-fg mb-1.5">{f.title}</p>
									<p className="text-[13px] text-muted leading-relaxed">{f.desc}</p>
								</div>
							</div>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   InstallTabs (npm / pnpm / bun switcher)
   ═══════════════════════════════════════════ */

const pkgManagers = [
	{ label: "npm", command: "npm install deloop.dev" },
	{ label: "pnpm", command: "pnpm add deloop.dev" },
	{ label: "bun", command: "bun add deloop.dev" },
] as const;

function InstallTabs() {
	const [active, setActive] = useState<number>(() => {
		try {
			const saved = localStorage.getItem("deloop-pm");
			const idx = pkgManagers.findIndex((p) => p.label === saved);
			return idx >= 0 ? idx : 0;
		} catch {
			return 0;
		}
	});

	const select = (i: number) => {
		setActive(i);
		try {
			localStorage.setItem("deloop-pm", pkgManagers[i]!.label);
		} catch {}
	};

	return (
		<div className="install-tabs rounded-lg border border-border overflow-hidden">
			<div className="flex items-center justify-between border-b border-border bg-bg-card">
				<div className="flex items-center">
					{pkgManagers.map((pm, i) => (
						<button
							key={pm.label}
							type="button"
							onClick={() => select(i)}
							className={`install-tab ${active === i ? "active" : ""}`}
						>
							{pm.label}
						</button>
					))}
				</div>
			</div>
			<div className="install-tabs-code">
				<CodeBlock lang="bash" code={pkgManagers[active]!.command} />
			</div>
		</div>
	);
}

/* ═══════════════════════════════════════════
   CodeBlock (Shiki syntax highlighter — output is trusted, not user-controlled)
   ═══════════════════════════════════════════ */

function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState("");
	const [copied, setCopied] = useState(false);
	const { resolved } = useTheme();
	const dark = resolved === "dark";

	useEffect(() => {
		getHighlighter().then((h) => {
			setHtml(
				h.codeToHtml(code, {
					lang,
					theme: dark ? "github-dark-default" : "github-light-default",
				}),
			);
		});
	}, [code, lang, dark]);

	const handleCopy = () => {
		navigator.clipboard
			.writeText(code)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {});
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
					// eslint-disable-next-line react/no-danger -- Shiki output is trusted (code-controlled, not user input)
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
			q: "How does team collaboration work?",
			a: "Everyone — designers, QA, PMs, developers — uses the same toolbar. Each annotation produces identical structured context regardless of who created it. Context flows to the team dashboard, Slack, Jira, or directly to your AI agent. Zero follow-up messages.",
		},
		{
			q: "How does this work with AI agents?",
			a: "Paste structured context into Claude, Cursor, or ChatGPT from the clipboard. Or connect via MCP, onSubmit, or a webhook — when anyone on your team annotates an issue, the structured payload flows directly into your agent with XPaths, component trees, and source file paths included.",
		},
		{
			q: "Who on my team can use it?",
			a: "Anyone. Designers capture pixel-perfect feedback with exact CSS values. QA files structured reports. PMs annotate staging. Developers paste context into their agent. No DevTools knowledge required — the toolbar handles the technical capture automatically.",
		},
		{
			q: "How does React context extraction work?",
			a: "When anyone selects an element, deloop reads the React fiber node and walks up the tree, capturing every component's name, props, and source file location. A designer's annotation carries the same source paths your agent or developer needs to act — all captured locally in the browser.",
		},
		{
			q: "Does it work without React?",
			a: "Yes. Element selection, XPaths, CSS selectors, computed styles, drawing, screenshots, and markers work on any website. React context is an automatic bonus when detected — everything else works everywhere.",
		},
		{
			q: "What output formats are supported?",
			a: "Clipboard copy as Markdown (paste into any LLM or share with teammates), downloadable JSON or Markdown files, webhook POST to any URL, and MCP for agent workflows. Images can be embedded as base64 or exported as separate PNG files.",
		},
		{
			q: "Can I customize the exported context?",
			a: "Yes. Pass a promptTemplate function that receives all annotations, page URL, viewport, and settings. Shape the structured context for your agent pipeline, your team's review workflow, or both.",
		},
		{
			q: "Does it affect my app's performance?",
			a: "No. The toolbar renders in its own isolated DOM container. It only reads the page when someone interacts with a tool — no polling, no mutation observers, no background overhead.",
		},
		{
			q: "Why not just use browser DevTools?",
			a: "DevTools is built for one developer debugging alone. deloop is a context layer — anyone on your team captures structured, actionable context without knowing what an XPath is. The same output works for your AI agent, your teammates, and your issue tracker.",
		},
	];

	const ref = useReveal();
	return (
		<section ref={ref} id="faq" className="mb-24 sm:mb-32 scroll-mt-20 reveal">
			<div className="text-center mb-10 sm:mb-12">
				<p className="section-label text-cyan before:bg-cyan justify-center">FAQ</p>

				<h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg tracking-[-0.025em] mb-3">
					Frequently asked <span className="gradient-warm">questions</span>
				</h2>
			</div>
			<div className="grid sm:grid-cols-2 gap-x-16 gap-y-6">
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
	const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(resetTimer.current), []);

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = e.currentTarget;
		const formData = new FormData(form);
		const email = formData.get("email") as string;
		const message = formData.get("message") as string;

		clearTimeout(resetTimer.current);
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
			resetTimer.current = setTimeout(() => setStatus("idle"), 5000);
		} catch {
			setStatus("error");
			resetTimer.current = setTimeout(() => setStatus("idle"), 5000);
		}
	};

	return (
		<section ref={ref} id="contact" className="mb-24 sm:mb-32 scroll-mt-20 reveal">
			<div className="grid sm:grid-cols-2 gap-6 items-start">
				{/* Left: copy */}
				<div>
					<p className="section-label text-accent before:bg-accent">Contact</p>
					<h2 className="text-2xl sm:text-3xl font-bold text-fg tracking-[-0.025em] mb-3">
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
								className="btn-warm disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{status === "sending" ? (
									<>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="3"
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
											strokeWidth="3"
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
];

function FooterLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			title={label}
			className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
		>
			{icon}
		</a>
	);
}

function Footer() {
	return (
		<footer className="border-t border-border pt-8 mt-4 pb-8">
			<div className="flex flex-wrap items-center gap-1 text-[13px]">
				{footerLinks.map((link) => (
					<FooterLink key={link.href} href={link.href} label={link.label} icon={link.icon} />
				))}
				<div className="ml-auto flex items-center gap-4">
					<a href="/privacy" className="text-muted/40 text-xs hover:text-muted transition-colors">
						Privacy
					</a>
					<a href="/terms" className="text-muted/40 text-xs hover:text-muted transition-colors">
						Terms
					</a>
					<span className="text-muted/30 text-xs">
						&copy; {new Date().getFullYear()} deloop.dev
					</span>
				</div>
			</div>
		</footer>
	);
}

/* ═══════════════════════════════════════════
   Theme Toggle
   ═══════════════════════════════════════════ */

function ThemeToggle({ theme, onCycle }: { theme: Theme; onCycle: () => void }) {
	const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";
	return (
		<button
			type="button"
			onClick={onCycle}
			className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors cursor-pointer"
			aria-label={`Theme: ${label}`}
			title={`Theme: ${label}`}
		>
			{theme === "light" ? (
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="5" />
					<line x1="12" y1="1" x2="12" y2="3" />
					<line x1="12" y1="21" x2="12" y2="23" />
					<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
					<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
					<line x1="1" y1="12" x2="3" y2="12" />
					<line x1="21" y1="12" x2="23" y2="12" />
					<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
					<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
				</svg>
			) : theme === "dark" ? (
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
				</svg>
			) : (
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
					<line x1="8" y1="21" x2="16" y2="21" />
					<line x1="12" y1="17" x2="12" y2="21" />
				</svg>
			)}
		</button>
	);
}

export default App;
