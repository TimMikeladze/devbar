/**
 * The getting-started prompt the hero hands to a coding agent.
 *
 * Written to be pasted into Claude Code, Cursor, Codex or any agent sitting in
 * the visitor's repository — it installs the package, mounts the toolbar in
 * development only, starts the local bridge and registers the MCP server. Every
 * command here mirrors the README and the "Local agent · MCP" section below; if
 * one changes, change it in all three.
 */
export const AGENT_SETUP_PROMPT = `Set up devbar in this project.

devbar (https://devbar.sh) is a drop-in dev toolbar. I point at an element in the
running app and write what I want changed; you get the exact context — CSS
selector, XPath, computed styles, the React component path with file:line, and
screenshots. Docs: https://github.com/TimMikeladze/devbar#readme

Do this:

1. Install \`devbar.sh\` with the package manager this repo already uses (match the
   lockfile).

2. Mount the toolbar in development only, once, at the app root:

   \`\`\`tsx
   "use client"; // Next.js App Router only

   import { Devbar } from "devbar.sh";
   import "devbar.sh/styles.css";

   export function DevToolbar() {
     if (process.env.NODE_ENV !== "development") return null;
     return <Devbar />;
   }
   \`\`\`

   Keep both imports at the top of that module. On Next.js, pull the module in
   with \`next/dynamic\` so the stylesheet stays out of the production bundle.
   Not a React app? Add \`<script src="https://devbar.sh/cdn.global.js"></script>\`
   and call \`window.Devbar.init()\` instead.

3. Start the local bridge in the project root, so reports reach you instead of my
   clipboard:

   \`\`\`bash
   bunx devbar.sh init   # writes devbar.config.ts
   bunx devbar.sh        # serves on 127.0.0.1:3100 and registers this project
   \`\`\`

   The toolbar discovers it on localhost by itself — no \`server\`, \`token\` or
   \`project\` props needed.

4. Register the MCP server with the agent CLI you are running as:

   \`\`\`bash
   claude mcp add devbar -- devbar mcp
   # codex mcp add devbar -- devbar mcp
   \`\`\`

5. Run \`bunx devbar.sh doctor\` and fix whatever it flags.

Then tell me how to capture my first report, and confirm you can reach the queue
(\`list_reports\`, \`get_report\`, \`claim_report\`, \`resolve_report\`) and the live
page (\`inspect_element\`, \`screenshot_page\`, \`highlight_element\`,
\`wait_for_reload\`).

Don't change unrelated code, and don't let the toolbar ship to production.`;
