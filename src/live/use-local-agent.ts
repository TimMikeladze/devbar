import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, CaptureConfig } from "@/session/types";
import { createLiveBridge, type LiveBridge, type LiveState } from "./bridge";
import { discoverLocalServer, isLocalPage, resolveProject, type LocalProject } from "./discovery";

/**
 * Connects the toolbar to the local devbar server without anyone wiring props.
 *
 * On a localhost page it probes for the server, asks which project claims this
 * origin, and — once the user opts in — opens the live bridge so an agent can
 * inspect and screenshot the page. Consent is per origin and remembered.
 */

export type LocalAgentOptions = {
	/** Explicit server URL. When set, discovery is skipped. */
	server?: string;
	token?: string;
	project?: string;
	/** false disables discovery entirely. */
	local?: boolean | { ports?: number[]; force?: boolean };
	/** false hides the live bridge, even when a server is found. */
	live?: boolean;
	getAnnotations: () => Annotation[];
	getCaptureConfig: () => CaptureConfig;
};

export type LocalAgentStatus = "off" | "searching" | "connected" | "unavailable";

export type LocalAgent = {
	status: LocalAgentStatus;
	url?: string;
	token?: string;
	project?: string;
	projects: LocalProject[];
	liveState: LiveState;
	liveEnabled: boolean;
	allowMutating: boolean;
	lastCall?: { method: string; at: number };
	setLiveEnabled: (value: boolean) => void;
	setAllowMutating: (value: boolean) => void;
	setProject: (slug: string) => void;
};

type Consent = { enabled: boolean; allowMutating: boolean };

function consentKey(): string {
	return `devbar:live:${typeof window === "undefined" ? "" : window.location.origin}`;
}

function readConsent(): Consent {
	try {
		const raw = localStorage.getItem(consentKey());
		if (raw) return { enabled: false, allowMutating: false, ...JSON.parse(raw) };
	} catch {}
	return { enabled: false, allowMutating: false };
}

function writeConsent(consent: Consent): void {
	try {
		localStorage.setItem(consentKey(), JSON.stringify(consent));
	} catch {}
}

const PROJECT_KEY = "devbar:project";

export function useLocalAgent(options: LocalAgentOptions): LocalAgent {
	const { server, token, project: projectProp, local, live } = options;

	const discoveryEnabled = local !== false && !server;
	const [status, setStatus] = useState<LocalAgentStatus>(
		server ? "connected" : discoveryEnabled ? "searching" : "off",
	);
	const [url, setUrl] = useState<string | undefined>(server);
	const [projects, setProjects] = useState<LocalProject[]>([]);
	const [discovered, setDiscovered] = useState<string | undefined>(undefined);
	const [chosen, setChosen] = useState<string | undefined>(() => {
		try {
			return localStorage.getItem(PROJECT_KEY) ?? undefined;
		} catch {
			return undefined;
		}
	});

	const [consent, setConsent] = useState<Consent>(() => readConsent());
	const [liveState, setLiveState] = useState<LiveState>({ status: "idle" });
	const [lastCall, setLastCall] = useState<{ method: string; at: number } | undefined>(undefined);

	const project = projectProp ?? chosen ?? discovered;

	// Latest-value refs keep the bridge from being torn down on every render.
	const annotationsRef = useRef(options.getAnnotations);
	const captureRef = useRef(options.getCaptureConfig);
	const consentRef = useRef(consent);
	annotationsRef.current = options.getAnnotations;
	captureRef.current = options.getCaptureConfig;
	consentRef.current = consent;

	useEffect(() => {
		if (!discoveryEnabled) return;
		let cancelled = false;

		void (async () => {
			const ports = typeof local === "object" ? local.ports : undefined;
			const force = typeof local === "object" ? local.force : undefined;
			const found = await discoverLocalServer({ ports, force, token, project: projectProp });
			if (cancelled) return;
			if (!found) {
				setStatus(isLocalPage() ? "unavailable" : "off");
				return;
			}
			setUrl(found.url);
			setProjects(found.handshake.projects);
			setDiscovered(
				found.project ?? resolveProject(found.handshake, window.location.origin, projectProp),
			);
			setStatus("connected");
		})();

		return () => {
			cancelled = true;
		};
	}, [discoveryEnabled, local, token, projectProp]);

	const bridgeRef = useRef<LiveBridge | undefined>(undefined);

	useEffect(() => {
		const liveAllowed = live !== false && consent.enabled && !!url;
		if (!liveAllowed) {
			bridgeRef.current?.disconnect();
			bridgeRef.current = undefined;
			return;
		}

		const bridge = createLiveBridge({
			server: url as string,
			token,
			project,
			getPermissions: () => ({
				enabled: consentRef.current.enabled,
				allowMutating: consentRef.current.allowMutating,
			}),
			getAnnotations: () => annotationsRef.current(),
			getCaptureConfig: () => captureRef.current(),
			onState: setLiveState,
			onCall: (method) => setLastCall({ method, at: Date.now() }),
		});
		bridgeRef.current = bridge;
		void bridge.connect();

		return () => {
			bridge.disconnect();
			bridgeRef.current = undefined;
		};
	}, [live, consent.enabled, url, token, project]);

	// Permission changes are pushed to the server, which does the enforcing.
	useEffect(() => {
		void bridgeRef.current?.syncPermissions();
	}, [consent.allowMutating]);

	const setLiveEnabled = useCallback((value: boolean) => {
		setConsent((prev) => {
			const next = { ...prev, enabled: value };
			writeConsent(next);
			return next;
		});
	}, []);

	const setAllowMutating = useCallback((value: boolean) => {
		setConsent((prev) => {
			const next = { ...prev, allowMutating: value };
			writeConsent(next);
			return next;
		});
	}, []);

	const setProject = useCallback((slug: string) => {
		setChosen(slug);
		try {
			localStorage.setItem(PROJECT_KEY, slug);
		} catch {}
	}, []);

	return useMemo(
		() => ({
			status,
			url,
			token,
			project,
			projects,
			liveState,
			liveEnabled: consent.enabled,
			allowMutating: consent.allowMutating,
			lastCall,
			setLiveEnabled,
			setAllowMutating,
			setProject,
		}),
		[
			status,
			url,
			token,
			project,
			projects,
			liveState,
			consent.enabled,
			consent.allowMutating,
			lastCall,
			setLiveEnabled,
			setAllowMutating,
			setProject,
		],
	);
}
