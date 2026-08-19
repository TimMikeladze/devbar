import "./styles.css";

import { useState, useEffect } from "react";
import { DefaultPage } from "./pages/default";
import { ServerNoAuthPage } from "./pages/server-no-auth";
import { ServerInjectedUserPage } from "./pages/server-injected-user";
import { ServerAuthProxyPage } from "./pages/server-auth-proxy";
import { ServerUserAndAuthProxyPage } from "./pages/server-user-and-auth-proxy";
import { CustomToolsPage } from "./pages/custom-tools";
import { LightThemePage } from "./pages/light-theme";
import { DarkThemePage } from "./pages/dark-theme";
import { AutoThemePage } from "./pages/auto-theme";
import { ClipboardOnlyPage } from "./pages/clipboard-only";
import { HostileHostCssPage } from "./pages/hostile-host-css";
import { LocalAgentPage } from "./pages/local-agent";

const routes: Record<string, { label: string; group: string; component: () => React.ReactNode }> = {
	"/": { label: "Default (no server, no auth)", group: "Auth Variations", component: DefaultPage },
	"/server-no-auth": {
		label: "Server (no auth)",
		group: "Auth Variations",
		component: ServerNoAuthPage,
	},
	"/server-injected-user": {
		label: "Server + Injected User",
		group: "Auth Variations",
		component: ServerInjectedUserPage,
	},
	"/server-auth-proxy": {
		label: "Server + Auth Proxy",
		group: "Auth Variations",
		component: ServerAuthProxyPage,
	},
	"/server-user-and-auth-proxy": {
		label: "Server + User + Auth Proxy",
		group: "Auth Variations",
		component: ServerUserAndAuthProxyPage,
	},
	"/local-agent": {
		label: "Local agent (auto-discovery)",
		group: "Auth Variations",
		component: LocalAgentPage,
	},
	"/clipboard-only": {
		label: "Clipboard Only",
		group: "Output Modes",
		component: ClipboardOnlyPage,
	},
	"/custom-tools": {
		label: "Custom Tools (select + marker)",
		group: "Configuration",
		component: CustomToolsPage,
	},
	"/hostile-host-css": {
		label: "Hostile Host CSS",
		group: "Configuration",
		component: HostileHostCssPage,
	},
	"/light-theme": { label: "Light Theme", group: "Themes", component: LightThemePage },
	"/dark-theme": { label: "Dark Theme", group: "Themes", component: DarkThemePage },
	"/auto-theme": { label: "Auto Theme", group: "Themes", component: AutoThemePage },
};

function NavIndex() {
	const groups = new Map<string, { path: string; label: string }[]>();
	for (const [path, route] of Object.entries(routes)) {
		if (!groups.has(route.group)) groups.set(route.group, []);
		groups.get(route.group)!.push({ path, label: route.label });
	}

	return (
		<main>
			<header style={{ marginBottom: 32 }}>
				<h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Devbar Test Pages</h1>
				<p style={{ color: "#6b7280", fontSize: 15 }}>
					Each page renders the Devbar toolbar with a different prop configuration.
				</p>
			</header>
			{[...groups.entries()].map(([group, items]) => (
				<section key={group} style={{ marginBottom: 24 }}>
					<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{group}</h2>
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						{items.map(({ path, label }) => (
							<a
								key={path}
								href={path}
								style={{
									padding: "10px 16px",
									background: "#f9fafb",
									border: "1px solid #e5e7eb",
									borderRadius: 8,
									color: "#1d4ed8",
									textDecoration: "none",
									fontSize: 14,
								}}
							>
								{label}
								<span style={{ color: "#9ca3af", marginLeft: 8, fontSize: 12 }}>{path}</span>
							</a>
						))}
					</div>
				</section>
			))}
		</main>
	);
}

export function App() {
	const [path, setPath] = useState(window.location.pathname);

	useEffect(() => {
		const onPop = () => setPath(window.location.pathname);
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	// Intercept link clicks for client-side navigation
	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			const anchor = (e.target as HTMLElement).closest("a");
			if (!anchor || !anchor.href) return;
			const url = new URL(anchor.href);
			if (url.origin !== window.location.origin) return;
			if (routes[url.pathname] || url.pathname === "/nav") {
				e.preventDefault();
				window.history.pushState(null, "", url.pathname);
				setPath(url.pathname);
				window.scrollTo(0, 0);
			}
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);

	if (path === "/nav") return <NavIndex />;

	const route = routes[path];
	if (!route) return <NavIndex />;

	const Page = route.component;
	return (
		<>
			<div
				data-devbar="test-nav"
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					zIndex: 100,
					background: "rgba(255,255,255,0.9)",
					backdropFilter: "blur(8px)",
					borderBottom: "1px solid #e5e7eb",
					padding: "6px 16px",
					display: "flex",
					alignItems: "center",
					gap: 12,
					fontSize: 13,
				}}
			>
				<a href="/nav" style={{ color: "#6b7280", textDecoration: "none", fontWeight: 600 }}>
					All Pages
				</a>
				<span style={{ color: "#d1d5db" }}>/</span>
				<span style={{ color: "#111827", fontWeight: 500 }}>{route.label}</span>
			</div>
			<div style={{ paddingTop: 40 }}>
				<Page />
			</div>
		</>
	);
}

export default App;
