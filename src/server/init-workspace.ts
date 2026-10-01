import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * `devbar init --workspace` — mount the Workspace in a Next.js app: one route
 * file, with the way in the user picked, and the environment it needs listed.
 * It writes nothing it would overwrite, and never edits the user's components.
 */

export const WORKSPACE_AUTH = ["github", "sso", "cloudflare", "token", "app"] as const;
export type WorkspaceAuth = (typeof WORKSPACE_AUTH)[number];

const AUTH_BLOCKS: Record<WorkspaceAuth, { options: string; env: string[] }> = {
	github: {
		options: `	// Deployed, people sign in with GitHub and act as themselves; without an
	// account (or access to the repository) they are refused. Locally, \`gh\` is you.
	requireGitHub: process.env.NODE_ENV === "production" ? "all" : false,`,
		env: [
			"DEVBAR_GITHUB_CLIENT_ID      OAuth App or GitHub App client id (callback: <site>/api/devbar/callback)",
			"DEVBAR_GITHUB_CLIENT_SECRET",
		],
	},
	sso: {
		options: `	// Deployed, people sign in with your identity provider (DEVBAR_OIDC_*), and
	// with GitHub on top to make changes as themselves.
	requireGitHub: process.env.NODE_ENV === "production" ? "writes" : false,`,
		env: [
			"DEVBAR_OIDC_ISSUER           e.g. https://acme.okta.com or https://accounts.google.com",
			"DEVBAR_OIDC_CLIENT_ID        redirect URI: <site>/api/devbar/sso-callback",
			"DEVBAR_OIDC_CLIENT_SECRET",
			"DEVBAR_OIDC_ALLOW            emails or @domains — required for Google",
			"DEVBAR_OIDC_LABEL            the button's name, e.g. Okta",
			"DEVBAR_GITHUB_CLIENT_ID      optional: lets people link GitHub to make changes",
			"DEVBAR_GITHUB_CLIENT_SECRET",
		],
	},
	cloudflare: {
		options: `	// Cloudflare Access in front of the site signs people in; this checks its JWT.
	authorize: cloudflareAccess({
		teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN ?? "",
		audience: process.env.CF_ACCESS_AUD ?? "",
	}),`,
		env: [
			"CF_ACCESS_TEAM_DOMAIN        <team> of <team>.cloudflareaccess.com",
			"CF_ACCESS_AUD                the Access application's AUD tag",
		],
	},
	token: {
		options: `	// One shared token: the shell asks for it once. DEVBAR_WORKSPACE_TOKEN.`,
		env: ["DEVBAR_WORKSPACE_TOKEN       hand this to the people who may in"],
	},
	app: {
		options: `	// Your app's own session decides. Return the user, or null to refuse.
	authorize: async (request) => {
		// const session = await auth.api.getSession({ headers: request.headers });
		// return session ? { name: session.user.name, email: session.user.email } : null;
		return null;
	},`,
		env: [],
	},
};

export function renderWorkspaceRoute(auth: WorkspaceAuth): string {
	const imports =
		auth === "cloudflare"
			? `import { cloudflareAccess, createWorkspaceRoutes } from "devbar.sh/next";`
			: `import { createWorkspaceRoutes } from "devbar.sh/next";`;
	return `${imports}

// The devbar Workspace: specs, skills and agent instructions beside the running
// app. \`next dev\` serves this checkout to localhost; a production build serves
// the GitHub repository. https://github.com/TimMikeladze/devbar/blob/main/docs/WORKSPACE.md
export const { GET, POST, OPTIONS } = createWorkspaceRoutes({
${AUTH_BLOCKS[auth].options}
});
`;
}

/** The variables a production deploy needs, with the chosen way in. */
export function workspaceEnv(auth: WorkspaceAuth): string[] {
	const signsIn = auth === "github" || auth === "sso";
	return [
		"DEVBAR_GITHUB_TOKEN          contents, pull requests, issues: write (or DEVBAR_GITHUB_APP_ID + _PRIVATE_KEY)",
		"DEVBAR_GITHUB_REPO           owner/name (automatic on Vercel)",
		...AUTH_BLOCKS[auth].env,
		...(signsIn
			? [`DEVBAR_SESSION_SECRET        e.g. ${randomBytes(32).toString("base64url")}`]
			: []),
	];
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function commandInitWorkspace(
	options: { auth?: string; cwd?: string; log?: (line: string) => void } = {},
): Promise<{ written?: string }> {
	const cwd = options.cwd ?? process.cwd();
	const log = options.log ?? console.log;
	const auth = (options.auth ?? "github") as WorkspaceAuth;
	if (!WORKSPACE_AUTH.includes(auth)) {
		throw new Error(`--auth must be one of ${WORKSPACE_AUTH.join(", ")}`);
	}

	let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
	try {
		pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8"));
	} catch {}
	const isNext = !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
	const appDir = (await exists(join(cwd, "src/app")))
		? join(cwd, "src/app")
		: (await exists(join(cwd, "app")))
			? join(cwd, "app")
			: undefined;

	if (!isNext || !appDir) {
		log("No Next.js App Router here. Mount the workspace on any fetch-style server:");
		log("");
		log('  import { createWorkspace } from "devbar.sh/workspace";');
		log("  const workspace = createWorkspace({ /* authorize, requireGitHub, ... */ });");
		log('  app.all("/api/devbar/*", (c) => workspace(c.req.raw)); // Hono');
		log("");
		log('Then: <Devbar workspace="/api/devbar" />');
		return {};
	}

	const route = join(appDir, "api/devbar/[...path]/route.ts");
	const shown = relative(cwd, route);
	if (await exists(route)) {
		log(`${shown} already exists — left as it is.`);
	} else {
		await mkdir(join(appDir, "api/devbar/[...path]"), { recursive: true });
		await writeFile(route, renderWorkspaceRoute(auth), "utf-8");
		log(`wrote ${shown} (auth=${auth})`);
	}
	log("");
	log("Next:");
	log('  1. Point the toolbar at it: <Devbar workspace="/api/devbar" />');
	log("  2. `next dev`, then open /api/devbar/shell");
	log("  3. For production, set:");
	for (const line of workspaceEnv(auth)) log(`       ${line}`);
	return { written: route };
}
