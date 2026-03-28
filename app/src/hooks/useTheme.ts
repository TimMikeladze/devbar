import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "deloop-theme";

let listeners: Array<() => void> = [];
function emit() {
	for (const l of listeners) l();
}

function getTheme(): Theme {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === "light" || stored === "dark" || stored === "system") return stored;
	return "system";
}

function getResolved(theme: Theme): "light" | "dark" {
	if (theme === "system") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	return theme;
}

function apply(theme: Theme) {
	const resolved = getResolved(theme);
	document.documentElement.classList.toggle("dark", resolved === "dark");
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute("content", resolved === "dark" ? "#0a0a0a" : "#fafafa");
}

// Apply on load
apply(getTheme());

// Intentional permanent listener — this module is loaded once in a browser-only SPA,
// so the listener lives for the lifetime of the page and never needs cleanup.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	apply(getTheme());
	emit();
});

export function useTheme() {
	const theme = useSyncExternalStore((cb) => {
		listeners.push(cb);
		return () => {
			listeners = listeners.filter((l) => l !== cb);
		};
	}, getTheme);

	const resolved = getResolved(theme);

	const setTheme = useCallback((next: Theme) => {
		localStorage.setItem(STORAGE_KEY, next);
		apply(next);
		emit();
	}, []);

	// Keep DOM in sync on mount
	useEffect(() => {
		apply(theme);
	}, [theme]);

	return { theme, resolved, setTheme } as const;
}
