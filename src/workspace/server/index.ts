/**
 * `devbar.sh/workspace` — the server half of the Workspace shell.
 *
 * `createWorkspace()` is the batteries-included entry: it picks the local or
 * GitHub backend from the environment and returns a fetch-style handler. The
 * pieces are exported too, for hosts that want to assemble their own.
 */
import type { WorkspaceConfig } from "../../config";
import type { WorkspaceBackend } from "./backend";
import { allowEmails } from "./auth";
import { WorkspaceHttpError } from "./errors";
import { createGitHubBackend, type GitHubBackendOptions } from "./github-backend";
import {
	createWorkspaceHandler,
	type WorkspaceHandler,
	type WorkspaceHandlerOptions,
} from "./handler";
import { createLocalBackend } from "./local-backend";

export type WorkspaceServerOptions = WorkspaceConfig &
	Pick<
		WorkspaceHandlerOptions,
		| "authorize"
		| "token"
		| "allowLoopback"
		| "checkOrigin"
		| "maxBodyBytes"
		| "shell"
		| "signIn"
		| "sso"
		| "githubToken"
		| "requireGitHub"
		| "webhookSecret"
		| "events"
	> & {
		/**
		 * `auto` (default) serves the working tree unless NODE_ENV is
		 * production, where it serves the GitHub repository. Override with
		 * DEVBAR_WORKSPACE_BACKEND, or pass a backend of your own.
		 */
		backend?: "auto" | "local" | "github" | WorkspaceBackend;
		/** Local backend: the project directory. Default process.cwd(). */
		root?: string;
		/** GitHub backend. Each field falls back to the environment. */
		github?: Partial<Omit<GitHubBackendOptions, "config">>;
		/** Where the defaults are read from. Default process.env. */
		env?: Record<string, string | undefined>;
	};

function pickBackend(options: WorkspaceServerOptions, env: Record<string, string | undefined>) {
	if (typeof options.backend === "object") return "custom" as const;
	const chosen = options.backend ?? env.DEVBAR_WORKSPACE_BACKEND ?? "auto";
	if (chosen === "local" || chosen === "github") return chosen;
	return env.NODE_ENV === "production" ? "github" : "local";
}

/**
 * A ready handler for the Workspace HTTP contract.
 *
 * GitHub settings fall back to `DEVBAR_GITHUB_TOKEN` (or `GITHUB_TOKEN`),
 * `DEVBAR_GITHUB_REPO` (or `GITHUB_REPOSITORY`, or Vercel's
 * `VERCEL_GIT_REPO_OWNER`/`VERCEL_GIT_REPO_SLUG`) and `DEVBAR_GITHUB_REF` (or
 * `VERCEL_GIT_COMMIT_REF`, so a preview deploy reads and proposes into its own
 * branch). The access token falls back to `DEVBAR_WORKSPACE_TOKEN`.
 *
 * Everything past the token is optional: `DEVBAR_GITHUB_CLIENT_ID`,
 * `DEVBAR_GITHUB_CLIENT_SECRET` and `DEVBAR_SESSION_SECRET` turn on signing in
 * with GitHub (an OAuth App is enough); `DEVBAR_GITHUB_APP_ID` and
 * `DEVBAR_GITHUB_APP_PRIVATE_KEY` use a GitHub App's installation token instead
 * of a PAT; `DEVBAR_GITHUB_WEBHOOK_SECRET` opens the webhook route.
 *
 * `DEVBAR_OIDC_ISSUER`, `DEVBAR_OIDC_CLIENT_ID` and `DEVBAR_OIDC_CLIENT_SECRET`
 * (with the session secret) add single sign-on — `DEVBAR_OIDC_ALLOW` narrows it
 * to emails or `@domains`, `DEVBAR_OIDC_LABEL` names the button.
 * `DEVBAR_WORKSPACE_REQUIRE_GITHUB=writes|all` makes a GitHub identity of one's
 * own a must for changes, or for everything.
 */
export function createWorkspace(options: WorkspaceServerOptions = {}): WorkspaceHandler {
	const env = options.env ?? process.env;
	const kind = pickBackend(options, env);
	const {
		backend: _backend,
		root,
		github,
		env: _env,
		authorize,
		token,
		allowLoopback,
		checkOrigin,
		maxBodyBytes,
		shell,
		signIn,
		sso,
		githubToken,
		requireGitHub,
		webhookSecret,
		events,
		...config
	} = options;

	const backend = (): WorkspaceBackend => {
		if (typeof options.backend === "object") return options.backend;
		if (kind === "local") return createLocalBackend({ root: root ?? process.cwd(), config });
		const serverToken = github?.token ?? env.DEVBAR_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
		const app =
			github?.app ??
			(env.DEVBAR_GITHUB_APP_ID && env.DEVBAR_GITHUB_APP_PRIVATE_KEY
				? {
						appId: env.DEVBAR_GITHUB_APP_ID,
						privateKey: env.DEVBAR_GITHUB_APP_PRIVATE_KEY,
						...(env.DEVBAR_GITHUB_APP_INSTALLATION_ID
							? { installationId: env.DEVBAR_GITHUB_APP_INSTALLATION_ID }
							: {}),
					}
				: undefined);
		const repo =
			github?.repo ??
			env.DEVBAR_GITHUB_REPO ??
			env.GITHUB_REPOSITORY ??
			(env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
				? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
				: undefined);
		const hasToken = !!serverToken || !!app;
		if (!hasToken || !repo) {
			throw new WorkspaceHttpError(503, "The GitHub workspace is not configured", {
				hint: `Set ${!hasToken ? "DEVBAR_GITHUB_TOKEN" : ""}${!hasToken && !repo ? " and " : ""}${!repo ? "DEVBAR_GITHUB_REPO (owner/name)" : ""}`,
			});
		}
		const ref = github?.ref ?? env.DEVBAR_GITHUB_REF ?? env.VERCEL_GIT_COMMIT_REF;
		return createGitHubBackend({
			...github,
			...(serverToken ? { token: serverToken } : {}),
			...(app ? { app } : {}),
			repo,
			...(ref ? { ref } : {}),
			config,
		});
	};

	// Sign-in only makes sense against GitHub, and only with all three values:
	// a half-configured sign-in is left off rather than half-working.
	const clientId = env.DEVBAR_GITHUB_CLIENT_ID;
	const clientSecret = env.DEVBAR_GITHUB_CLIENT_SECRET;
	const sessionSecret = env.DEVBAR_SESSION_SECRET;
	const githubSignIn =
		signIn ??
		(kind === "github" && clientId && clientSecret && sessionSecret && sessionSecret.length >= 32
			? { clientId, clientSecret, secret: sessionSecret }
			: undefined);

	// Single sign-on works on either backend: issuer, client and the session secret.
	const oidcIssuer = env.DEVBAR_OIDC_ISSUER;
	const oidcClientId = env.DEVBAR_OIDC_CLIENT_ID;
	const oidcClientSecret = env.DEVBAR_OIDC_CLIENT_SECRET;
	const oidcAllow = env.DEVBAR_OIDC_ALLOW?.split(",").filter((entry) => entry.trim());
	const ssoOptions =
		sso ??
		(oidcIssuer && oidcClientId && oidcClientSecret && sessionSecret && sessionSecret.length >= 32
			? {
					issuer: oidcIssuer,
					clientId: oidcClientId,
					clientSecret: oidcClientSecret,
					secret: sessionSecret,
					...(env.DEVBAR_OIDC_LABEL ? { label: env.DEVBAR_OIDC_LABEL } : {}),
					...(oidcAllow?.length ? { user: allowEmails(oidcAllow) } : {}),
				}
			: undefined);

	const envRequire = env.DEVBAR_WORKSPACE_REQUIRE_GITHUB;
	const mustHaveGitHub =
		requireGitHub ?? (envRequire === "writes" || envRequire === "all" ? envRequire : false);
	// Nobody could ever satisfy it: say how to fix it rather than lock everyone out.
	if (mustHaveGitHub && kind === "github" && !githubSignIn && !githubToken) {
		return async () =>
			new Response(
				JSON.stringify({
					error: "requireGitHub is on, but nobody can sign in with GitHub",
					hint: "Set DEVBAR_GITHUB_CLIENT_ID, DEVBAR_GITHUB_CLIENT_SECRET and DEVBAR_SESSION_SECRET, or pass signIn or githubToken",
				}),
				{
					status: 503,
					headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
				},
			);
	}

	return createWorkspaceHandler({
		backend,
		authorize,
		token: token ?? env.DEVBAR_WORKSPACE_TOKEN,
		// Only the working tree on this machine is open to localhost callers by
		// default. A GitHub repository is reachable from anywhere the site is.
		allowLoopback: allowLoopback ?? kind === "local",
		checkOrigin,
		maxBodyBytes,
		shell,
		...(githubSignIn ? { signIn: githubSignIn } : {}),
		...(ssoOptions ? { sso: ssoOptions } : {}),
		...(githubToken ? { githubToken } : {}),
		...(mustHaveGitHub ? { requireGitHub: mustHaveGitHub } : {}),
		...(webhookSecret || env.DEVBAR_GITHUB_WEBHOOK_SECRET
			? { webhookSecret: webhookSecret ?? env.DEVBAR_GITHUB_WEBHOOK_SECRET }
			: {}),
		// A serverless function cannot hold a stream open for long.
		events: events ?? (kind === "github" ? { maxMs: 240_000 } : {}),
	});
}

export { createWorkspaceHandler, createLocalBackend, createGitHubBackend, WorkspaceHttpError };
export {
	allowEmails,
	anyOf,
	cloudflareAccess,
	googleIap,
	trustedJwt,
	userFromClaims,
	type Authorize,
	type ClaimsToUser,
	type TrustedJwtOptions,
} from "./auth";
export { createJwksVerifier, JwtError, type JwtClaims } from "./jwt";
export type { SsoOptions } from "./oidc";
export { classifyPath, parseDoc, DEFAULT_DOC_DIRS, DEFAULT_SPEC_DIRS } from "../classify";
export type { WorkspaceBackend } from "./backend";
export type {
	AuthorizeResult,
	ShellOptions,
	SignInOptions,
	WorkspaceHandler,
	WorkspaceHandlerOptions,
} from "./handler";
export type { Actor } from "./backend";
export type { AppCredentials } from "../github/app";
export type { GitHubBackendOptions } from "./github-backend";
export type { LocalBackendOptions } from "./local-backend";
export type { WorkspaceConfig } from "../../config";
export type * from "../types";
