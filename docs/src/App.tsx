import { useEffect, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-dark-default"],
			langs: ["typescript", "bash", "html", "tsx"],
		});
	}
	return highlighterPromise;
}

function App() {
	return (
		<div className="min-h-screen hero-glow dot-pattern">
			<Header />
			<main className="max-w-5xl mx-auto px-5 sm:px-8 pt-20 sm:pt-24 pb-10">
				<Hero />
				<Features />
				<Examples />
				<FAQ />
				<Footer />
			</main>
		</div>
	);
}

function Header() {
	return (
		<header className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-xl border-b border-border/50">
			<div className="max-w-5xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
				<a href="/" className="text-fg font-semibold tracking-tight">
					deloop.dev
				</a>
				<nav className="flex items-center gap-5 text-[13px]">
					<a
						href="https://github.com/TimMikeladze/deloop"
						className="text-muted hover:text-fg transition-colors flex items-center gap-1.5"
					>
						<GitHubIcon />
						GitHub
					</a>
					<a
						href="https://www.npmjs.com/package/deloop.dev"
						className="text-bg bg-fg rounded-md px-3 py-1 font-medium hover:bg-fg/85 transition-colors"
					>
						Install
					</a>
				</nav>
			</div>
		</header>
	);
}

function Hero() {
	return (
		<section className="mb-14 sm:mb-18">
			<p className="text-muted text-[13px] tracking-wide mb-4">Open source &middot; MIT</p>
			<h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.5rem] font-bold tracking-[-0.035em] leading-[1.08] mb-4">
				Annotate any website,
				<br />
				<span className="gradient-agent">prompt any LLM.</span>
			</h1>
			<p className="text-dim text-[15px] sm:text-base leading-[1.7] mb-6 max-w-lg">
				Drop-in toolbar that lets users select elements, draw, capture screenshots, and
				place markers. Exports all context — XPaths, CSS selectors, React components,
				computed styles — as a structured prompt ready for any LLM.
			</p>
			<CodeBlock lang="bash" code={`bun add deloop.dev`} />
		</section>
	);
}

function Features() {
	const features = [
		{
			color: "bg-accent",
			label: "Element inspector",
			desc: "Click any element to capture its XPath, CSS selector, tag, classes, computed styles, and outer HTML",
		},
		{
			color: "bg-cyan",
			label: "React context extraction",
			desc: "Walks the React fiber tree to capture component hierarchy, props, and source locations",
		},
		{
			color: "bg-emerald",
			label: "Freehand drawing",
			desc: "Draw annotations directly on the page with automatic context screenshot capture",
		},
		{
			color: "bg-amber",
			label: "Screenshot capture",
			desc: "Full-page or region screenshots exported as base64 or separate image files",
		},
		{
			color: "bg-rose",
			label: "Numbered markers",
			desc: "Place numbered pins on the page with nearest element context auto-detected",
		},
		{
			color: "bg-cyan",
			label: "LLM-ready prompts",
			desc: "Generates structured Markdown with page URL, viewport, annotations, and a fix request",
		},
		{
			color: "bg-emerald",
			label: "Custom prompt templates",
			desc: "Pass your own prompt template function to control exactly what gets sent to the LLM",
		},
		{
			color: "bg-accent",
			label: "Clipboard & file export",
			desc: "Copy the prompt to clipboard, or download as JSON or Markdown with optional separate image files",
		},
		{
			color: "bg-amber",
			label: "Webhook delivery",
			desc: "POST the full payload to any URL for integration with your own backend or pipeline",
		},
		{
			color: "bg-rose",
			label: "Chrome extension",
			desc: "Use deloop on any website without modifying source code — install the extension and go",
		},
		{
			color: "bg-cyan",
			label: "CDN script tag",
			desc: "Add a single script tag to any HTML page — no build step, no framework required",
		},
		{
			color: "bg-emerald",
			label: "Plugin system",
			desc: "Extend the toolbar with custom tools, panels, and bar buttons via the plugin API",
		},
		{
			color: "bg-accent",
			label: "Theme & position",
			desc: "Light, dark, or auto theme. Place the toolbar in any corner. Draggable by default",
		},
	];

	return (
		<section className="mb-14 sm:mb-18">
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

function Examples() {
	const [tab, setTab] = useState(0);

	const tabs = [
		{
			label: "React",
			color: "bg-accent",
			title: "React Component",
			desc: "Import the toolbar as a React component. Configure tools, theme, position, and handle submissions with a callback.",
		},
		{
			label: "CDN",
			color: "bg-cyan",
			title: "CDN Script Tag",
			desc: "Drop a single script tag into any HTML page. No build step, no framework. Call window.Deloop.init() to launch.",
		},
		{
			label: "Vanilla JS",
			color: "bg-amber",
			title: "Programmatic Init",
			desc: "Import the init function for non-React apps. Returns a destroy handle for cleanup.",
		},
		{
			label: "Prompt",
			color: "bg-emerald",
			title: "Custom Prompts",
			desc: "Pass a custom prompt template function to control the output format. Receives all annotations, page context, and settings.",
		},
		{
			label: "Webhook",
			color: "bg-rose",
			title: "Webhook Integration",
			desc: "Send the full payload to your backend on submit. Combine with onSubmit for custom workflows.",
		},
		{
			label: "Plugins",
			color: "bg-cyan",
			title: "Plugin System",
			desc: "Extend the toolbar with custom tools. Each plugin gets an icon, label, optional panel, and lifecycle hooks.",
		},
		{
			label: "Output",
			color: "bg-amber",
			title: "Generated Output",
			desc: "The toolbar generates a structured Markdown prompt with page info, element selectors, React context, screenshots, and a fix request.",
		},
	];

	const examples = [
		{
			lang: "tsx",
			code: `import { Deloop } from "deloop.dev";
import "deloop.dev/styles.css";

function App() {
  return (
    <>
      <YourApp />
      <Deloop
        // All tools enabled by default, or pick specific ones
        tools={["select", "draw", "capture", "marker"]}
        // Toolbar placement
        position="bottom-right"
        theme="auto"
        // Copy prompt to clipboard on submit
        clipboard
        // Handle the structured payload
        onSubmit={(payload) => {
          console.log(payload.prompt);       // Markdown prompt
          console.log(payload.annotations);  // All captured data
          console.log(payload.url);          // Page URL
        }}
      />
    </>
  );
}`,
		},
		{
			lang: "html",
			code: `<!DOCTYPE html>
<html>
<head>
  <title>My Website</title>
</head>
<body>
  <h1>Hello World</h1>

  <!-- Add deloop with a single script tag -->
  <script src="https://unpkg.com/deloop.dev/cdn"></script>
  <script>
    // Initialize with optional config
    const { destroy } = window.Deloop.init({
      position: "bottom-right",
      theme: "dark",
      clipboard: true,
      onSubmit: (payload) => {
        // Send to your backend, paste into ChatGPT, etc.
        console.log(payload.prompt);
      },
    });

    // Call destroy() to remove the toolbar
  </script>
</body>
</html>`,
		},
		{
			lang: "typescript",
			code: `import { init } from "deloop.dev";
import "deloop.dev/styles.css";

// Launch the toolbar programmatically
const { destroy } = init({
  position: "top-right",
  theme: "light",
  clipboard: true,
  tools: ["select", "capture", "marker"],
  onSubmit: (payload) => {
    // payload.prompt — ready-to-paste Markdown
    // payload.annotations — structured annotation data
    // payload.url — current page URL
    // payload.viewport — { width, height }
    // payload.timestamp — submission time
    fetch("/api/feedback", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
});

// Clean up when done
destroy();`,
		},
		{
			lang: "typescript",
			code: `import { Deloop } from "deloop.dev";
import type { PromptTemplate } from "deloop.dev";

// Custom prompt template — receives all context
const myTemplate: PromptTemplate = (ctx) => {
  const elements = ctx.annotations
    .filter((a) => a.type === "element")
    .map((a) => \`- \${a.data.xpath}\`)
    .join("\\n");

  return \`## Issue on \${ctx.url}
Viewport: \${ctx.viewport.width}x\${ctx.viewport.height}
Browser: \${ctx.userAgent}

### Selected Elements
\${elements}

### Instructions
Fix the CSS issues on the elements listed above.
Keep changes minimal and backwards-compatible.\`;
};

<Deloop promptTemplate={myTemplate} />`,
		},
		{
			lang: "typescript",
			code: `import { Deloop } from "deloop.dev";

// Send payload to your backend on every submit
<Deloop
  webhookUrl="https://api.example.com/feedback"
  onSubmit={(payload) => {
    // Also runs after webhook delivery
    // Use for notifications, analytics, etc.
    showToast("Feedback sent!");
  }}
/>

// The webhook receives a POST with:
// {
//   url: "https://...",
//   route: { pathname, search, hash },
//   title: "Page Title",
//   viewport: { width: 1920, height: 1080 },
//   userAgent: "Mozilla/5.0 ...",
//   timestamp: 1709654321000,
//   annotations: [ ... ],
//   prompt: "# Bug Report\\n\\n..."
// }`,
		},
		{
			lang: "typescript",
			code: `import { Deloop } from "deloop.dev";
import type { DeloopPlugin } from "deloop.dev";

const performancePlugin: DeloopPlugin = {
  key: "perf",
  label: "Performance",
  shortcut: "p",
  icon: () => <span>P</span>,
  panel: () => (
    <div>
      <h3>Performance Metrics</h3>
      <p>LCP: {performance.getEntriesByType("paint")[0]?.startTime}ms</p>
    </div>
  ),
  onActivate: () => console.log("Perf tool activated"),
  onDeactivate: () => console.log("Perf tool deactivated"),
};

<Deloop plugins={[performancePlugin]} />`,
		},
		{
			lang: "bash",
			code: `# The generated prompt looks like this:

# Bug Report

## Page Information
- **URL:** https://example.com/dashboard
- **Route:** /dashboard
- **Title:** My Dashboard
- **Viewport:** 1920x1080
- **User Agent:** Mozilla/5.0 ...

## Annotations

### Annotation 1: element
- **Tag:** button
- **ID:** submit-btn
- **Classes:** btn, btn-primary
- **XPath:** \`/html/body/div/main/form/button\`
- **CSS Selector:** \`#submit-btn\`
- **Computed Styles:**
  - color: rgb(255, 255, 255)
  - background-color: rgb(59, 130, 246)
- **React Component Path:** \`App > Dashboard > Form > Button\`

### Annotation 2: screenshot
- **Region:** 400x300 at (100, 200)
- **Image:** ![screenshot](data:image/png;base64,...)

## Request
Based on the annotations above, please analyze the issues
found on this page and suggest specific fixes.`,
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

function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState("");

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

	return (
		<div className="rounded-lg border border-border overflow-hidden">
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
			q: "Why not a browser DevTools extension?",
			a: "DevTools is for developers. deloop.dev is a toolbar you embed in your app so anyone — designers, QA, PMs — can annotate issues and generate LLM-ready context without leaving the page.",
		},
		{
			q: "How does React context extraction work?",
			a: "When you select an element, deloop walks the React fiber tree to find the component hierarchy, props, and source file locations. This gives the LLM enough context to suggest exact code changes.",
		},
		{
			q: "Does it work without React?",
			a: "Yes. React context extraction is automatic when React is detected, but all other features — element selection, XPaths, CSS selectors, drawing, screenshots, markers — work on any website.",
		},
		{
			q: "What output formats are supported?",
			a: "Copy to clipboard as Markdown, download as JSON or Markdown files, or POST to a webhook URL. Images can be embedded as base64 or exported as separate files.",
		},
		{
			q: "Can I customize the prompt?",
			a: "Yes. Pass a promptTemplate function that receives all annotations, page URL, viewport, user agent, and settings. Return any string you want — Markdown, XML, plain text.",
		},
		{
			q: "How do I use it on sites I don't own?",
			a: "Install the Chrome extension. It injects the toolbar into any page without modifying the source code.",
		},
		{
			q: "Does it affect my app's performance?",
			a: "The toolbar renders in its own DOM container and only captures data when you interact with it. No polling, no mutation observers running in the background.",
		},
	];

	return (
		<section className="mb-14 sm:mb-18">
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

function Footer() {
	return (
		<footer className="border-t border-border pt-6">
			<div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
				<div className="flex items-center gap-4">
					<a
						href="https://github.com/TimMikeladze/deloop"
						className="hover:text-fg transition-colors"
					>
						GitHub
					</a>
					<a
						href="https://www.npmjs.com/package/deloop.dev"
						className="hover:text-fg transition-colors"
					>
						npm
					</a>
					<a
						href="https://github.com/TimMikeladze/deloop/releases"
						className="hover:text-fg transition-colors"
					>
						Releases
					</a>
				</div>
				<div className="flex items-center gap-4">
					<a href="https://x.com/linesofcode" className="hover:text-fg transition-colors">
						X
					</a>
					<a
						href="https://bsky.app/profile/linesofcode.bsky.social"
						className="hover:text-fg transition-colors"
					>
						Bluesky
					</a>
				</div>
			</div>
			<p className="text-muted/30 text-xs mt-4 pb-4">&copy; {new Date().getFullYear()} deloop.dev</p>
		</footer>
	);
}

function GitHubIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

export default App;
