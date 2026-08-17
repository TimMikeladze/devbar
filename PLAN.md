# Devbar - Design Plan

## What

Drop-in annotation toolbar for any website. Users annotate, capture XPaths, screenshots, and contextual info to prompt an LLM with fixes.

## Who

Developers, QA testers, and end users. Toolbar adapts via `mode` config (`developer` | `qa` | `user`).

## Distribution

1. **React component** (primary) - `<Devbar />`
2. **Script tag** - `Devbar.init(config)` wraps React mount
3. **Browser extension** - future phase

## Architecture

Monolithic toolbar component. Three UI layers:

1. **Floating Panel** - draggable, minimizable toolbar with tool buttons + submit/cancel
2. **Overlay Layer** - full-viewport transparent overlay for tool interactions
3. **Session Panel** - collapsible list of accumulated annotations

### Toolbar Behavior

- Defaults to bottom-right, user drags anywhere
- Auto-minimizes when a tool mode is active
- Re-expands when tool action completes or user hits Escape
- Minimized state: small floating pill (logo only)
- Position remembered in session (not across page loads)

## Tool Modes

### Select

- Hover highlights elements with outline
- Click captures: XPath, CSS selector, tag/id/classes, computed styles (subset), inner text (truncated), bounding rect, outerHTML (truncated)
- Optional text note after capture

### Draw

- Full-page canvas overlay
- Tools: pen, arrow, rectangle, circle
- Done/Escape to finish
- Captures drawing as PNG data URI with viewport offset

### Text

- Click anywhere to place a text pin
- Input popover at click point
- Stores: text, position (x,y), nearest element XPath
- Pin icon remains visible on page

### Capture (Screenshot)

- Full page: html2canvas entire viewport
- Region: click+drag selection box
- Captures as PNG data URI

## Data Model

```typescript
type AnnotationType = "element" | "drawing" | "text" | "screenshot";

type Annotation = {
	id: string;
	type: AnnotationType;
	timestamp: number;
	data: ElementData | DrawingData | TextData | ScreenshotData;
	note?: string;
};

type ElementData = {
	xpath: string;
	cssSelector: string;
	tagName: string;
	id: string;
	classes: string[];
	computedStyles: Record<string, string>;
	innerText: string;
	boundingRect: DOMRect;
	outerHTML: string;
};

type DrawingData = {
	imageDataUri: string;
	viewportOffset: { x: number; y: number };
	dimensions: { width: number; height: number };
};

type TextData = {
	text: string;
	position: { x: number; y: number };
	nearestElementXPath: string;
};

type ScreenshotData = {
	imageDataUri: string;
	region?: { x: number; y: number; width: number; height: number };
	fullPage: boolean;
};
```

## Output

### Payload

```typescript
type DevbarPayload = {
	url: string;
	title: string;
	viewport: { width: number; height: number };
	userAgent: string;
	timestamp: number;
	annotations: Annotation[];
	prompt: string; // rendered from template
};
```

### Channels

1. **Clipboard** - structured prompt + base64 images as markdown
2. **Webhook** - POST JSON payload to configured endpoint

### Prompt Templates

```typescript
type PromptTemplate = (context: {
	url: string;
	title: string;
	viewport: { width: number; height: number };
	userAgent: string;
	annotations: Annotation[];
}) => string;
```

Ships with sensible defaults. Consumer can provide custom function or string template.

## Component API

```tsx
<Devbar
	// Output
	clipboard={true}
	onSubmit={(payload) => fetch("/api/bugs", { body: JSON.stringify(payload) })}
	promptTemplate={customTemplate}
	// UI
	position="bottom-right"
	minimized={false}
	theme="light" // "light" | "dark" | "auto"
	// Tools
	tools={["select", "draw", "text", "capture"]}
	// Persona
	mode="developer" // "developer" | "qa" | "user"
/>
```

### Script Tag API

```js
Devbar.init({
  clipboard: true,
  onSubmit: (payload) => { ... },
  position: 'bottom-right',
  mode: 'qa'
})
```

## Persona Modes

| Feature         | developer      | qa                | user               |
| --------------- | -------------- | ----------------- | ------------------ |
| XPath/CSS       | Shown          | Shown             | Hidden             |
| Computed styles | Shown          | Hidden            | Hidden             |
| outerHTML       | Shown          | Hidden            | Hidden             |
| Drawing tools   | All            | All               | Pen + arrow only   |
| Prompt detail   | Full technical | Structured report | Simple description |

## File Structure

```
src/
  index.tsx                    # Public exports
  toolbar/
    toolbar.tsx                # Main Devbar component
    toolbar.module.css         # Toolbar styles (prefixed)
    drag.ts                    # Drag-and-drop logic
    state.ts                   # Session store (annotations, active mode)
  tools/
    select/
      select-overlay.tsx       # Hover highlight + click capture
      element-data.ts          # XPath/CSS selector/style extraction
    draw/
      draw-overlay.tsx         # Canvas overlay
      shapes.ts                # Pen, arrow, rect, circle renderers
    text/
      text-overlay.tsx         # Click-to-place text pins
      text-pin.tsx             # Individual pin component
    capture/
      capture-overlay.tsx      # Region selection UI
      screenshot.ts            # html2canvas wrapper
  session/
    panel.tsx                  # Annotation list panel
    types.ts                   # Annotation types
  output/
    payload.ts                 # Build structured payload
    clipboard.ts               # Copy-to-clipboard logic
    prompt.ts                  # Default prompt template
    webhook.ts                 # POST to endpoint
  standalone.ts                # Devbar.init() for script tag usage
```

## CSS Isolation

Scoped CSS modules with `devbar-` prefix on all class names. No Shadow DOM.

## Constraints

- No cross-page persistence
- No console/network auto-capture in v1
- No authentication in toolbar
- No direct LLM API calls from toolbar
- Webhook is fire-and-forget (no response handling)
- html2canvas for screenshots (no native browser APIs)

## Decision Log

| #   | Decision                          | Alternatives                | Rationale                                 |
| --- | --------------------------------- | --------------------------- | ----------------------------------------- |
| 1   | Monolithic component              | Plugin arch, Headless+UI    | 4 tools in v1; simple to ship             |
| 2   | Scoped/prefixed CSS               | Shadow DOM, iframe          | Pragmatic, avoids complexity              |
| 3   | Draggable floating panel          | Fixed sidebar, bottom bar   | Must not obstruct annotated page          |
| 4   | Auto-minimize during tool use     | Keep visible                | Maximize visible page area                |
| 5   | Multi-annotation sessions         | Single per submit           | Complex bugs need multiple evidence       |
| 6   | Clipboard + webhook output        | Direct LLM API, SaaS        | Consumer controls destination             |
| 7   | Configurable prompt templates     | Fixed format                | Different personas need different prompts |
| 8   | Three persona modes               | Single mode                 | Balance simplicity with detail levels     |
| 9   | html2canvas                       | Native APIs, extension-only | Cross-browser, no permissions needed      |
| 10  | No cross-page persistence         | localStorage                | Keeps v1 simple                           |
| 11  | React primary, script tag wrapper | Script tag first            | Project is React; wrapper is thin         |
| 12  | No console/network in v1          | Include from start          | Tight scope; easy to add later            |
