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

/** A dispatch run, as the toolbar needs to show it. Mirrors the server's Task. */
export type LocalTask = {
	id: string;
	reportId: string;
	projectSlug: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	result?: {
		exitCode: number;
		durationMs: number;
		model: string;
		costUsd?: number;
		/** The server stopped underneath the run — not the agent's own failure. */
		interrupted?: boolean;
	};
};

/** A submitted report the server is holding. */
export type LocalReport = {
	id: string;
	project?: string;
	status: "new" | "claimed" | "dispatched" | "resolved";
	createdAt: number;
	assets: string[];
};

/** What a run actually sent, and what came back. Fetched only when expanded. */
export type LocalRunDetail = {
	/** The prompt handed to the agent — the report, rendered. */
	prompt?: string;
	/** The agent's own output, once the run has finished. */
	output?: string;
	exitCode?: number;
	changedFiles?: string[];
	error?: string;
};

/** An agent session attached over MCP. */
export type LocalMcpSession = {
	id: string;
	client: string;
	clientVersion?: string;
	project?: string;
	tools: string[];
	transport: "stdio";
	connectedAt: number;
	lastSeen: number;
	lastTool?: { name: string; at: number };
};

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
	/**
	 * Reports that have been submitted but not handed to an agent.
	 *
	 * With `autoDispatch` off — the default, and the right default — Submit
	 * stores a report and stops. Nothing used to say so, which reads as the
	 * agent ignoring the request. These are the ones waiting on a person.
	 */
	pendingReports: LocalReport[];
	/** Dispatch runs for this project, newest first. Only populated while watched. */
	tasks: LocalTask[];
	/** Agent sessions attached over MCP. Only populated while watched. */
	mcpSessions: LocalMcpSession[];
	/** Why the activity feed is empty, when it is empty for a reason. */
	activityError?: string;
	/**
	 * Turns the activity feed on and off.
	 *
	 * An SSE stream and a poll per open tab is a real cost to impose on every
	 * page carrying the toolbar, and nobody is reading a run list that is not on
	 * screen — so the Agent tab asks for the feed while it is open and gives it
	 * back when it closes.
	 */
	watchActivity: (value: boolean) => void;
	/**
	 * The prompt a run was given, and what the agent said back.
	 *
	 * Loaded on demand rather than with the run list: a prompt carries the whole
	 * report, screenshots included, and pulling that for every row would make
	 * opening the tab cost more than reading it.
	 */
	getRunDetail: (task: LocalTask) => Promise<LocalRunDetail>;
	/** Hands one report — or every pending one — to the agent. */
	dispatchReports: (reportId?: string) => Promise<void>;
	cancelTask: (id: string) => Promise<void>;
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

	// ─── activity: dispatch runs and attached MCP sessions ──────────────────
	const [watching, setWatching] = useState(false);
	const [tasks, setTasks] = useState<LocalTask[]>([]);
	const [pendingReports, setPendingReports] = useState<LocalReport[]>([]);
	const [mcpSessions, setMcpSessions] = useState<LocalMcpSession[]>([]);
	const [activityError, setActivityError] = useState<string | undefined>(undefined);

	const authHeaders = useMemo(
		() => (token ? { Authorization: `Bearer ${token}` } : undefined),
		[token],
	);

	useEffect(() => {
		if (!watching || !url || status !== "connected") return;

		let cancelled = false;
		const sorted = (list: LocalTask[]) => [...list].sort((a, b) => b.createdAt - a.createdAt);

		async function load(): Promise<void> {
			try {
				const query = project ? `?project=${encodeURIComponent(project)}` : "";
				const [taskRes, mcpRes, reportRes] = await Promise.all([
					fetch(`${url}/api/tasks${query}`, { headers: authHeaders }),
					fetch(`${url}/api/mcp/sessions`, { headers: authHeaders }),
					fetch(`${url}/api/reports${query}`, { headers: authHeaders }),
				]);
				if (cancelled) return;
				if (!taskRes.ok) throw new Error(`${taskRes.status}`);
				const taskData = (await taskRes.json()) as { tasks: LocalTask[] };
				const mcpData = mcpRes.ok
					? ((await mcpRes.json()) as { sessions: LocalMcpSession[] })
					: undefined;
				const reportData = reportRes.ok
					? ((await reportRes.json()) as { reports: LocalReport[] })
					: undefined;
				if (cancelled) return;
				setTasks(sorted(taskData.tasks ?? []));
				setMcpSessions(mcpData?.sessions ?? []);
				setPendingReports(
					(reportData?.reports ?? [])
						.filter((report) => report.status === "new")
						.sort((a, b) => b.createdAt - a.createdAt),
				);
				setActivityError(undefined);
			} catch (err) {
				if (!cancelled) setActivityError(err instanceof Error ? err.message : String(err));
			}
		}

		void load();
		// MCP sessions have no event stream — they are a heartbeat, so they are
		// polled. Tasks come in over SSE below and this only backstops them.
		const poll = setInterval(() => void load(), 5_000);

		// EventSource cannot set an Authorization header, which is why the server
		// takes the token in the query string for streams.
		const streamUrl = `${url}/api/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
		const source = new EventSource(streamUrl);
		const onTask = (event: MessageEvent) => {
			try {
				const { task } = JSON.parse(event.data) as { task: LocalTask };
				if (!task) return;
				setTasks((prev) => sorted([task, ...prev.filter((t) => t.id !== task.id)]));
			} catch {}
		};
		source.addEventListener("task", onTask as EventListener);

		return () => {
			cancelled = true;
			clearInterval(poll);
			source.removeEventListener("task", onTask as EventListener);
			source.close();
		};
	}, [watching, url, status, project, token, authHeaders]);

	const watchActivity = useCallback((value: boolean) => setWatching(value), []);

	const getRunDetail = useCallback(
		async (task: LocalTask): Promise<LocalRunDetail> => {
			if (!url) return { error: "Not connected to a devbar server" };
			try {
				const [promptRes, taskRes] = await Promise.all([
					fetch(`${url}/api/reports/${encodeURIComponent(task.reportId)}/prompt`, {
						headers: authHeaders,
					}),
					fetch(`${url}/api/tasks/${encodeURIComponent(task.id)}`, { headers: authHeaders }),
				]);

				const prompt = promptRes.ok
					? ((await promptRes.json()) as { prompt?: string }).prompt
					: undefined;
				const detail = taskRes.ok
					? ((await taskRes.json()) as {
							result?: { output?: string; exitCode?: number; changedFiles?: string[] };
						})
					: undefined;

				return {
					prompt,
					output: detail?.result?.output,
					exitCode: detail?.result?.exitCode,
					changedFiles: detail?.result?.changedFiles,
					// A report can be deleted while its task record survives; say so
					// rather than showing an empty box.
					error: prompt === undefined ? "The report for this run is no longer on disk" : undefined,
				};
			} catch (err) {
				return { error: err instanceof Error ? err.message : String(err) };
			}
		},
		[url, authHeaders],
	);

	const dispatchReports = useCallback(
		async (reportId?: string) => {
			if (!url) return;
			try {
				const res = await fetch(`${url}/api/dispatch`, {
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders },
					body: JSON.stringify({ project, report: reportId }),
				});
				if (!res.ok) throw new Error(`${res.status}`);
				// Take it off the pending list now rather than waiting for the poll:
				// a button that stays put for five seconds reads as not having worked.
				setPendingReports((prev) => (reportId ? prev.filter((r) => r.id !== reportId) : []));
			} catch (err) {
				setActivityError(err instanceof Error ? err.message : String(err));
			}
		},
		[url, authHeaders, project],
	);

	const cancelTask = useCallback(
		async (id: string) => {
			if (!url) return;
			try {
				await fetch(`${url}/api/tasks/${encodeURIComponent(id)}/cancel`, {
					method: "POST",
					headers: authHeaders,
				});
			} catch (err) {
				setActivityError(err instanceof Error ? err.message : String(err));
			}
		},
		[url, authHeaders],
	);

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
			pendingReports,
			tasks,
			mcpSessions,
			activityError,
			watchActivity,
			getRunDetail,
			dispatchReports,
			cancelTask,
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
			pendingReports,
			tasks,
			mcpSessions,
			activityError,
			watchActivity,
			getRunDetail,
			dispatchReports,
			cancelTask,
			setLiveEnabled,
			setAllowMutating,
			setProject,
		],
	);
}
