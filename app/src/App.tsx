import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { createHighlighter, type Highlighter } from "shiki";
import { Deloop } from "deloop.dev";
import "deloop.dev/styles.css";
import { PricingCards } from "./components/PricingCards";
import { LogoMark } from "./components/Logo";
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
		<div className="min-h-screen page-grid">
			<Header />
			<main className="relative z-[1] max-w-6xl mx-auto px-5 sm:px-8 pt-16 sm:pt-20 pb-10">
				<Hero />
				<TrustStrip />
				<BeforeAfter />
				<HowItWorks />
				<CapturedData />
				<DropItIn />
				<Features />
				<Pricing />
				<FAQ />
				<Contact />
				<Footer />
			</main>
		</div>
	);
}

/* ═══════════════════════════════════════════
   Shared: section eyebrow
   ═══════════════════════════════════════════ */

function Eyebrow({ children, center }: { children: React.ReactNode; center?: boolean }) {
	return <p className={`dl-eyebrow ${center ? "justify-center" : ""}`}>{children}</p>;
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
		{ href: "#how-it-works", label: "How it works" },
		{ href: "#pricing", label: "Pricing" },
		{ href: "#faq", label: "FAQ" },
		{ href: "https://github.com/TimMikeladze/deloop", label: "GitHub", external: true },
	];

	return (
		<header className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-xl border-b border-border/60">
			<div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
				<a
					href="/"
					className="flex items-center gap-2 text-fg font-semibold tracking-tight text-[15px]"
				>
					<Wordmark />
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
						Sign in
					</Link>
					<Link to="/login?signup=1" className="btn-signal text-[13px] !py-1.5 !px-3.5">
						Get started
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
				<nav className="mobile-menu sm:hidden border-t border-border/60 bg-bg/95 backdrop-blur-xl px-5 py-4 space-y-1">
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
					<div className="border-t border-border/60 pt-3 mt-3 flex items-center gap-3">
						<ThemeToggle theme={theme} onCycle={cycle} />
						<Link to="/login" className="text-[14px] text-fg font-medium">
							Sign in
						</Link>
						<Link to="/login?signup=1" className="btn-signal text-[13px] !py-1.5 !px-3.5">
							Get started
						</Link>
					</div>
				</nav>
			)}
		</header>
	);
}

function Wordmark() {
	return (
		<>
			<LogoMark />
			deloop
		</>
	);
}

/* ═══════════════════════════════════════════
   Hero
   ═══════════════════════════════════════════ */

function Hero() {
	return (
		<section className="mb-16 sm:mb-24 pt-6 sm:pt-10">
			<div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-12 items-center">
				{/* Left: copy */}
				<div className="hero-stagger text-center lg:text-left">
					<Eyebrow>
						<span className="dl-dot" />
						Open source · MIT licensed
					</Eyebrow>
					<h1 className="headline text-[2.6rem] sm:text-[3.4rem] lg:text-[3.6rem] font-bold tracking-[-0.035em] leading-[1.04] mb-5">
						Point at what to change.
						<br />
						<span className="text-signal">Your agent ships it.</span>
					</h1>
					<p className="text-dim text-[15px] sm:text-[17px] leading-[1.65] mb-7 max-w-xl mx-auto lg:mx-0">
						deloop is a drop-in inspector for any website. Point at an element, note the change you
						want, and it captures the exact context — selectors, computed styles, the React tree,
						and the source file. Iterate at agent speed, or send it to a GitHub issue or your team.
					</p>
					<div className="max-w-sm mx-auto lg:mx-0 mb-6">
						<InstallTabs />
					</div>
					<div className="flex items-center justify-center lg:justify-start gap-3 flex-wrap">
						<a href="#how-it-works" className="btn-signal">
							See how it works
						</a>
						<a
							href="https://github.com/TimMikeladze/deloop"
							target="_blank"
							rel="noopener noreferrer"
							className="btn-ghost"
						>
							<GithubGlyph />
							Star on GitHub
						</a>
					</div>
				</div>

				{/* Right: live inspector demo */}
				<div className="hero-demo-in">
					<InspectorDemo />
				</div>
			</div>

			{/* Real Deloop toolbar — dogfooded, floats freely via position:fixed */}
			<Deloop
				server={import.meta.env.VITE_DELOOP_SERVER || ""}
				wsServer={import.meta.env.VITE_DELOOP_WS_SERVER}
				project="deloop"
			/>
		</section>
	);
}

/* Inspector demo — mock app with a selection overlay + structured readout */
function InspectorDemo() {
	return (
		<div className="inspect-stage">
			<div className="browser-mock">
				<div className="browser-bar">
					<span className="browser-dot" />
					<span className="browser-dot" />
					<span className="browser-dot" />
					<span className="browser-url">app.example.com/orders</span>
				</div>
				<div className="mock-app">
					<div className="mock-line w-2/5" />
					<div className="mock-line w-3/5 opacity-70" />
					<div className="mock-field" />
					<div className="mock-field w-4/5" />
					<div className="mock-target">
						<button type="button" className="mock-btn" tabIndex={-1}>
							Submit order
						</button>
						{/* selection overlay */}
						<span className="sel-box" aria-hidden="true">
							<span className="sel-corner sel-tl" />
							<span className="sel-corner sel-tr" />
							<span className="sel-corner sel-bl" />
							<span className="sel-corner sel-br" />
							<span className="sel-dim">120 × 40</span>
							<span className="sel-tag">button#submit-btn</span>
						</span>
						{/* animated inspector cursor */}
						<span className="demo-cursor" aria-hidden="true">
							<svg width="20" height="20" viewBox="0 0 24 24">
								<path d="M4 2.5L4 18.5L8 14.5L10.6 20L12.8 19L10.2 13.6L16 13.6Z" />
							</svg>
						</span>
					</div>
				</div>
			</div>

			<div className="readout readout-float readout-live">
				<div className="readout-head">
					<span className="dl-dot" />
					captured context
				</div>
				<div className="readout-body">
					<div className="readout-row">
						<span className="rk">xpath</span>
						<span className="rv">/html/body/div/main/form/button</span>
					</div>
					<div className="readout-row">
						<span className="rk">css</span>
						<span className="rv">#submit-btn</span>
					</div>
					<div className="readout-row">
						<span className="rk">bg</span>
						<span className="rv">
							<span className="swatch" style={{ background: "#3b82f6" }} />
							rgb(59, 130, 246)
						</span>
					</div>
					<div className="readout-row">
						<span className="rk">react</span>
						<span className="rv rv-accent">App › OrderForm › Button</span>
					</div>
					<div className="readout-row">
						<span className="rk">source</span>
						<span className="rv rv-accent">src/ui/Button.tsx:6</span>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ═══════════════════════════════════════════
   Trust strip
   ═══════════════════════════════════════════ */

function TrustStrip() {
	const items = [
		"Works on any site",
		"React-aware",
		"MCP-ready",
		"Zero build step",
		"Self-hostable",
	];
	return (
		<div className="trust-strip mb-24 sm:mb-32">
			{items.map((t) => (
				<span key={t} className="trust-chip">
					<span className="dl-dot" />
					{t}
				</span>
			))}
		</div>
	);
}

/* ═══════════════════════════════════════════
   Before vs After
   ═══════════════════════════════════════════ */

function BeforeAfter() {
	const ref = useReveal();
	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-14">
				<Eyebrow center>The gap</Eyebrow>
				<h2 className="section-title">“Just make it pop” isn’t a spec.</h2>
				<p className="section-sub">
					A screenshot and “can we tighten this?” isn’t context. It’s the start of a twenty-minute
					thread — and your agent can’t act on it either.
				</p>
			</div>

			<div className="grid sm:grid-cols-2 gap-4">
				{/* The old way */}
				<div className="cmp cmp-bad">
					<div className="cmp-head">
						<XGlyph />
						The old way
					</div>
					<div className="cmp-body space-y-3">
						<div className="rounded-lg border border-border p-3 bg-bg-code">
							<div className="flex items-center gap-2 mb-2">
								<span className="w-5 h-5 rounded-full bg-rose/15 flex items-center justify-center text-[10px]">
									💬
								</span>
								<span className="text-[11px] text-dim font-medium">Design in #product</span>
							</div>
							<p className="text-muted italic text-[13px]">
								“can we make the hero feel less cramped? the spacing looks off”
							</p>
							<div className="mt-2 rounded border border-border bg-bg h-16 flex items-center justify-center text-[10px] text-muted/50">
								screenshot.png
							</div>
						</div>
						<div className="space-y-1.5 pl-4 border-l-2 border-border">
							{[
								["Dev", "Which section?"],
								["Design", "the top one on the landing page"],
								["Dev", "The heading, or the whole block?"],
								["Design", "…the block with the button"],
							].map(([who, msg], i) => (
								<p key={i} className="text-[12px]">
									<span className="text-dim font-medium">{who}:</span>{" "}
									<span className="text-muted italic">“{msg}”</span>
								</p>
							))}
						</div>
						<p className="text-[11px] text-rose/90 font-medium">
							4 messages. 20 minutes. Neither your teammate nor your agent can act.
						</p>
					</div>
				</div>

				{/* The deloop way */}
				<div className="cmp cmp-good">
					<div className="cmp-head">
						<CheckGlyph />
						With deloop
					</div>
					<div className="cmp-body font-mono">
						<div className="space-y-2 text-[11px]">
							{[
								["tag", "button#submit-btn", "fg"],
								["xpath", "/html/body/div/main/form/button", "fg"],
							].map(([k, v]) => (
								<div key={k} className="flex gap-2">
									<span className="text-muted/60 w-[52px] shrink-0">{k}</span>
									<span className="text-fg text-[10px]">{v}</span>
								</div>
							))}
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">bg</span>
								<span className="text-fg">
									<span className="inline-block w-2 h-2 rounded-sm bg-accent mr-1 align-middle" />
									rgb(59, 130, 246)
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">react</span>
								<span className="text-accent">App › OrderForm › Button</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">source</span>
								<span className="text-accent">src/ui/Button.tsx:6</span>
							</div>
							<div className="border-t border-border pt-2 mt-2 flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">note</span>
								<span className="text-fg font-sans">
									“Increase top padding to 96px — feels cramped”
								</span>
							</div>
							<div className="flex gap-2">
								<span className="text-muted/60 w-[52px] shrink-0">📷</span>
								<span className="text-dim font-sans">annotated screenshot attached</span>
							</div>
						</div>
						<p className="text-[11px] text-emerald/90 font-medium font-sans mt-3">
							One click. Hand it to your agent, open a GitHub issue, or share with the team.
						</p>
					</div>
				</div>
			</div>
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
			n: "01",
			title: "Annotate",
			desc: "Point at an element, circle a region, or drop a marker — then note the change you want. No DevTools required.",
			items: ["Element selection", "Freehand & markers", "Notes & screenshots"],
		},
		{
			n: "02",
			title: "Capture",
			desc: "deloop reads the DOM and React fiber tree — selectors, styles, components, and source paths.",
			items: ["XPaths & CSS selectors", "Computed styles", "React tree & source locations"],
		},
		{
			n: "03",
			title: "Route",
			desc: "Send it where you work — your AI agent, a GitHub issue, the dashboard, or any endpoint.",
			items: ["Agents via MCP & webhooks", "GitHub, Slack, Jira, Linear", "JSON & Markdown export"],
		},
	];

	return (
		<section ref={ref} id="how-it-works" className="mb-24 sm:mb-32 scroll-mt-20 reveal">
			<div className="text-center mb-10 sm:mb-14">
				<Eyebrow center>How it works</Eyebrow>
				<h2 className="section-title">Annotate. Capture. Route.</h2>
				<p className="section-sub">
					Three steps from “change this” to a payload your agent can act on.
				</p>
			</div>

			<div className="grid sm:grid-cols-3 gap-4">
				{steps.map((step) => (
					<div key={step.n} className="step">
						<div className="step-top">
							<span className="step-idx">{step.n}</span>
							<span className="step-rule" />
						</div>
						<h3 className="text-[15px] font-semibold text-fg mb-1.5">{step.title}</h3>
						<p className="text-[13px] text-muted leading-relaxed mb-4">{step.desc}</p>
						<ul className="space-y-1.5">
							{step.items.map((item) => (
								<li key={item} className="flex items-center gap-2 text-[12px] text-dim font-mono">
									<span className="step-tick" />
									{item}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
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
			<div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-14 items-center">
				<div className="text-center lg:text-left">
					<Eyebrow>What gets captured</Eyebrow>
					<h2 className="section-title !text-left max-lg:!text-center">
						Everything your agent needs to nail the change.
					</h2>
					<p className="section-sub !mx-0 max-lg:!mx-auto">
						One click grabs the full technical fingerprint of an element — so your agent (or a
						teammate) changes exactly the right thing, the first time.
					</p>
					<div className="flex flex-wrap gap-2 mt-6 justify-center lg:justify-start">
						{[
							"Selectors",
							"Computed styles",
							"React tree",
							"Bounding rect",
							"Source path",
							"HTML",
						].map((t) => (
							<span key={t} className="tagpill">
								{t}
							</span>
						))}
					</div>
				</div>

				<div className="readout">
					<div className="readout-head">
						<span className="dl-dot" />
						Element annotation
						<span className="ml-auto text-muted font-normal normal-case tracking-normal text-[11px]">
							button#submit-btn
						</span>
					</div>
					<div className="readout-body space-y-4">
						<div className="readout-sec">
							<div className="readout-label">Selectors</div>
							<Row k="xpath" v="/html/body/div/main/form/button" small />
							<Row k="css" v="#submit-btn" />
							<Row k="classes" v=".btn .btn-primary" />
						</div>
						<div className="readout-sec">
							<div className="readout-label">Computed styles</div>
							<Row k="background" v={<Swatch color="#3b82f6" label="rgb(59, 130, 246)" />} />
							<Row k="color" v={<Swatch color="#ffffff" label="rgb(255, 255, 255)" />} />
							<Row k="font-size" v="14px" />
							<Row k="padding" v="8px 16px" />
						</div>
						<div className="readout-sec">
							<div className="readout-label">React component tree</div>
							<div className="text-accent text-[12px] font-mono mb-1">
								App › Dashboard › OrderForm › Button
							</div>
							<Row k="props" v={`{ variant: "primary", size: "md" }`} small />
							<Row k="source" v={<span className="rv-accent">src/ui/Button.tsx:6</span>} small />
						</div>
						<div className="readout-sec">
							<div className="readout-label">Layout</div>
							<Row k="size" v="120 × 40" />
							<Row k="position" v="(450, 320)" />
							<Row k="text" v={`"Submit order"`} />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function Row({ k, v, small }: { k: string; v: React.ReactNode; small?: boolean }) {
	return (
		<div className="readout-row">
			<span className="rk">{k}</span>
			<span className={`rv ${small ? "text-[11px]" : ""}`}>{v}</span>
		</div>
	);
}

function Swatch({ color, label }: { color: string; label: string }) {
	return (
		<>
			<span className="swatch" style={{ background: color }} />
			{label}
		</>
	);
}

/* ═══════════════════════════════════════════
   Drop It In (integration + code tabs)
   ═══════════════════════════════════════════ */

function DropItIn() {
	const ref = useReveal();
	const [tab, setTab] = useState(0);

	const tabs = [
		{
			label: "React",
			desc: "One component. Every annotation becomes a change your agent or teammates can act on.",
			lang: "tsx",
			code: `import { Deloop } from "deloop.dev";
import "deloop.dev/styles.css";

<Deloop onSubmit={(payload) => agent.send(payload)} />`,
		},
		{
			label: "Script tag",
			desc: "No build step. Drop one tag on any HTML page and start capturing.",
			lang: "html",
			code: `<script src="https://unpkg.com/deloop.dev/cdn"></script>
<script>window.Deloop.init();</script>`,
		},
		{
			label: "Webhook / MCP",
			desc: "POST the payload to any URL, or expose annotations over MCP so your agent can pull them.",
			lang: "tsx",
			code: `<Deloop server="https://api.yourapp.com/bugs" />
// or init({ server: "..." }) for non-React apps`,
		},
		{
			label: "Markdown",
			desc: "Structured context on the clipboard — paste into Claude, Cursor, or ChatGPT.",
			lang: "bash",
			code: `# Bug Report — app.example.com/dashboard

### Annotation 1 · element
> QA: Button color doesn't match the design spec
- XPath:  /html/body/div/main/form/button
- CSS:    #submit-btn
- Styles: background: rgb(59, 130, 246); font-size: 14px
- React:  App › OrderForm › Button  (src/ui/Button.tsx:6)

### Annotation 2 · marker
> Designer: This row is misaligned with the header`,
		},
		{
			label: "JSON",
			desc: "The full machine-readable payload — pipe to an agent or store it on the dashboard.",
			lang: "json",
			code: `{
  "url": "https://app.example.com/dashboard",
  "viewport": { "width": 1440, "height": 900 },
  "annotations": [{
    "type": "element",
    "comments": [{ "author": "QA", "text": "Wrong color" }],
    "data": {
      "cssSelector": "#submit-btn",
      "computedStyles": { "background-color": "rgb(59, 130, 246)" },
      "reactContext": {
        "componentPath": "App › OrderForm › Button",
        "source": { "fileName": "src/ui/Button.tsx", "lineNumber": 6 }
      }
    }
  }]
}`,
		},
	];

	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-14">
				<Eyebrow center>Integrate</Eyebrow>
				<h2 className="section-title">Add it once. Context flows everywhere.</h2>
				<p className="section-sub">
					Ship it as a React component, a script tag, or a programmatic init — then route each
					change to your agent over MCP, a GitHub issue, a webhook, Slack, Jira, or Linear.
				</p>
			</div>

			<div className="code-panel">
				<div className="code-tabs tabs-scroll">
					{tabs.map((t, i) => (
						<button
							key={t.label}
							type="button"
							onClick={() => setTab(i)}
							className={`code-tab ${tab === i ? "active" : ""}`}
						>
							{t.label}
						</button>
					))}
				</div>
				<p className="text-[13px] text-muted leading-relaxed px-1 mt-3 mb-3">{tabs[tab]!.desc}</p>
				<CodeBlock lang={tabs[tab]!.lang} code={tabs[tab]!.code} />
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Features (bento)
   ═══════════════════════════════════════════ */

function Features() {
	const ref = useReveal();
	const features = [
		{
			label: "Element inspector",
			desc: "XPath, CSS selector, computed styles, bounding rect, and HTML for every click.",
			span: "bento-lg",
			glyph: <CrosshairGlyph />,
		},
		{
			label: "React context",
			desc: "Component hierarchy, props, and source file locations, straight from the fiber tree.",
			glyph: <TreeGlyph />,
		},
		{
			label: "Drawing & markers",
			desc: "Freehand strokes, numbered pins, and region screenshots — each with context attached.",
			glyph: <PenGlyph />,
		},
		{
			label: "Comments & threads",
			desc: "Notes ride along with every annotation, so the change you want travels with the data.",
			glyph: <ChatGlyph />,
		},
		{
			label: "MCP & webhooks",
			desc: "Route to agents over MCP, POST to any URL, or copy to the clipboard.",
			span: "bento-lg",
			glyph: <PlugGlyph />,
		},
		{
			label: "Export anywhere",
			desc: "One-click Markdown or JSON — for an LLM, a ticket, or an agent pipeline.",
			glyph: <ExportGlyph />,
		},
		{
			label: "Drop-in script",
			desc: "One CDN tag, zero build step. Works on any HTML page.",
			glyph: <BoltGlyph />,
		},
		{
			label: "Plugins & theming",
			desc: "Custom tools, panels, light/dark themes, draggable positioning.",
			glyph: <BlocksGlyph />,
		},
	];

	return (
		<section ref={ref} className="mb-24 sm:mb-32 reveal">
			<div className="text-center mb-10 sm:mb-14">
				<Eyebrow center>Features</Eyebrow>
				<h2 className="section-title">Every tool captures agent-ready context.</h2>
			</div>
			<div className="bento">
				{features.map((f) => (
					<div key={f.label} className={`bento-card ${f.span ?? ""}`}>
						<span className="bento-glyph">{f.glyph}</span>
						<p className="text-[14px] font-semibold text-fg mb-1">{f.label}</p>
						<p className="text-[13px] text-muted leading-relaxed">{f.desc}</p>
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
			<div className="text-center mb-10 sm:mb-14">
				<Eyebrow center>Pricing</Eyebrow>
				<h2 className="section-title">Capture context. Free.</h2>
				<p className="section-sub">
					The inspector is free and open source. Add the hosted dashboard when your team wants
					shared history and change requests in one place.
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
			q: "How does this work with AI agents?",
			a: "Paste the context into Cursor, Claude, or ChatGPT — or connect over MCP, onSubmit, or a webhook so your agent picks up changes automatically.",
		},
		{
			q: "Does it work without React?",
			a: "Yes. Every tool works on any website. React component context is an automatic bonus when a fiber tree is detected.",
		},
		{
			q: "How does team collaboration work?",
			a: "Everyone uses the same toolbar. Change requests and bug reports flow to the dashboard, a GitHub issue, Slack, or your agent with identical context.",
		},
		{
			q: "Will it slow down my app?",
			a: "No. The toolbar renders in its own isolated DOM container with zero background overhead.",
		},
		{
			q: "Why not just use browser DevTools?",
			a: "DevTools is for one developer debugging alone. deloop lets anyone — design, PM, QA — point at a change and hand off the exact context.",
		},
		{
			q: "Is it really open source?",
			a: "Yes. MIT licensed, self-hostable, and free forever. The paid dashboard is optional.",
		},
	];

	const ref = useReveal();
	return (
		<section ref={ref} id="faq" className="mb-24 sm:mb-32 scroll-mt-20 reveal">
			<div className="text-center mb-10 sm:mb-14">
				<Eyebrow center>FAQ</Eyebrow>
				<h2 className="section-title">Frequently asked questions</h2>
			</div>
			<div className="grid sm:grid-cols-2 gap-x-12 gap-y-8">
				{faqs.map((f) => (
					<div key={f.q}>
						<p className="text-[14px] font-semibold text-fg mb-1.5 flex gap-2">
							<span className="text-accent font-mono text-[13px]">›</span>
							{f.q}
						</p>
						<p className="text-[13px] text-muted leading-relaxed pl-[18px]">{f.a}</p>
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
			<div className="cta-frame">
				<div className="grid sm:grid-cols-2 gap-8 sm:gap-10 items-start">
					{/* Left: copy */}
					<div>
						<Eyebrow>Contact</Eyebrow>
						<h2 className="text-2xl sm:text-[2rem] font-bold text-fg tracking-[-0.03em] mb-3 leading-[1.1]">
							Close the loop with us.
						</h2>
						<p className="text-[14px] text-muted leading-relaxed mb-6 max-w-sm">
							A question, a feature request, or just want to say hi? We read everything.
						</p>
						<div className="space-y-3">
							<a
								href="https://github.com/TimMikeladze/deloop/issues"
								target="_blank"
								rel="noopener noreferrer"
								className="contact-link group"
							>
								<span className="contact-ico">
									<GithubGlyph />
								</span>
								<span>
									<span className="text-fg font-medium block text-[13px]">Open an issue</span>
									<span className="text-[12px] text-muted">Bugs & feature requests on GitHub</span>
								</span>
							</a>
							<a
								href="https://x.com/linesofcode"
								target="_blank"
								rel="noopener noreferrer"
								className="contact-link group"
							>
								<span className="contact-ico">
									<XLogoGlyph />
								</span>
								<span>
									<span className="text-fg font-medium block text-[13px]">@linesofcode</span>
									<span className="text-[12px] text-muted">DMs open on X</span>
								</span>
							</a>
						</div>
					</div>

					{/* Right: form */}
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
									className="btn-signal disabled:opacity-50 disabled:cursor-not-allowed"
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
											Sending…
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
									<span className="text-emerald text-[12px]">Thanks! We’ll be in touch soon.</span>
								)}
								{status === "error" && (
									<span className="text-rose text-[12px]">Something went wrong. Try again.</span>
								)}
							</div>
						</form>
					</div>
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════ */

const footerLinks = [
	{ href: "https://github.com/TimMikeladze/deloop", label: "GitHub", icon: <GithubGlyph /> },
	{ href: "https://x.com/linesofcode", label: "X", icon: <XLogoGlyph /> },
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

function Footer() {
	return (
		<footer className="border-t border-border pt-8 mt-4 pb-8">
			<div className="flex flex-wrap items-center gap-1 text-[13px]">
				<span className="flex items-center gap-2 text-fg font-semibold tracking-tight mr-3">
					<Wordmark />
				</span>
				{footerLinks.map((link) => (
					<a
						key={link.href}
						href={link.href}
						target="_blank"
						rel="noopener noreferrer"
						title={link.label}
						className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
					>
						{link.icon}
					</a>
				))}
				<div className="ml-auto flex items-center gap-4">
					<span className="text-muted text-xs">&copy; {new Date().getFullYear()} deloop.dev</span>
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

/* ═══════════════════════════════════════════
   Glyphs
   ═══════════════════════════════════════════ */

function GithubGlyph() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

function XLogoGlyph() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
		</svg>
	);
}

const glyphProps = {
	width: 18,
	height: 18,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.6,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
};

function CrosshairGlyph() {
	return (
		<svg {...glyphProps}>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
		</svg>
	);
}
function TreeGlyph() {
	return (
		<svg {...glyphProps}>
			<rect x="9" y="3" width="6" height="4" rx="1" />
			<rect x="3" y="17" width="6" height="4" rx="1" />
			<rect x="15" y="17" width="6" height="4" rx="1" />
			<path d="M12 7v4M6 17v-3h12v3" />
		</svg>
	);
}
function PenGlyph() {
	return (
		<svg {...glyphProps}>
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
		</svg>
	);
}
function ChatGlyph() {
	return (
		<svg {...glyphProps}>
			<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
		</svg>
	);
}
function PlugGlyph() {
	return (
		<svg {...glyphProps}>
			<path d="M12 22v-5M9 8V2M15 8V2M18 8H6v4a6 6 0 006 6 6 6 0 006-6z" />
		</svg>
	);
}
function ExportGlyph() {
	return (
		<svg {...glyphProps}>
			<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
		</svg>
	);
}
function BoltGlyph() {
	return (
		<svg {...glyphProps}>
			<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
		</svg>
	);
}
function BlocksGlyph() {
	return (
		<svg {...glyphProps}>
			<rect x="3" y="3" width="7" height="7" rx="1" />
			<rect x="14" y="3" width="7" height="7" rx="1" />
			<rect x="3" y="14" width="7" height="7" rx="1" />
			<rect x="14" y="14" width="7" height="7" rx="1" />
		</svg>
	);
}
function XGlyph() {
	return (
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
	);
}
function CheckGlyph() {
	return (
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
	);
}

export default App;
