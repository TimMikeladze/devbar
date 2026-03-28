import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

export type DashboardContext = {
	user: { id: string; name: string; email: string; image?: string | null };
	activeOrg: { id: string; name: string; slug: string } | null;
};

export type Report = {
	id: string;
	organizationId: string | null;
	userId: string | null;
	authorName: string | null;
	authorEmail: string | null;
	authorAvatar: string | null;
	payload: any;
	url: string;
	title: string;
	createdAt: string;
};

export type Comment = {
	id: string;
	reportId: string;
	userId: string | null;
	authorName: string | null;
	text: string;
	createdAt: string;
};

export type ReportWithComments = Report & { comments: Comment[] };

export function useReports(orgId: string | undefined) {
	const [reports, setReports] = useState<Report[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController>(undefined);

	const refresh = useCallback(() => {
		abortRef.current?.abort();
		if (!orgId) {
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		const controller = new AbortController();
		abortRef.current = controller;
		api<Report[]>(`/reports?organizationId=${orgId}`)
			.then((data) => {
				if (controller.signal.aborted) return;
				// Sort newest first defensively
				data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
				setReports(data);
				setError(null);
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				const code = (err as any).code;
				if (code === "NO_SUBSCRIPTION" || code === "SUBSCRIPTION_INACTIVE") {
					setError("subscription_inactive");
				} else {
					setError(err.message);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
	}, [orgId]);

	useEffect(() => {
		refresh();
		return () => abortRef.current?.abort();
	}, [refresh]);

	return { reports, loading, error, refresh };
}

export function useReport(id: string | undefined) {
	const [report, setReport] = useState<ReportWithComments | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController>(undefined);

	const refresh = useCallback(() => {
		abortRef.current?.abort();
		if (!id) {
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		const controller = new AbortController();
		abortRef.current = controller;
		api<ReportWithComments>(`/reports/${id}`)
			.then((data) => {
				if (controller.signal.aborted) return;
				setReport(data);
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setError(err.message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
	}, [id]);

	useEffect(() => {
		refresh();
		return () => abortRef.current?.abort();
	}, [refresh]);

	return { report, loading, error, refresh };
}

export function useFilteredReports(orgId: string | undefined) {
	const { reports, loading, error, refresh } = useReports(orgId);
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<string | null>(null);

	const filtered = useMemo(() => {
		let result = reports;

		if (search) {
			const q = search.toLowerCase();
			result = result.filter(
				(r) =>
					r.title?.toLowerCase().includes(q) ||
					r.url?.toLowerCase().includes(q) ||
					r.authorName?.toLowerCase().includes(q) ||
					(r.payload as any)?.label?.toLowerCase().includes(q),
			);
		}

		if (typeFilter) {
			result = result.filter((r) => {
				const annotations = (r.payload as any)?.annotations ?? [];
				return annotations.some((a: any) => a.type === typeFilter);
			});
		}

		return result;
	}, [reports, search, typeFilter]);

	const grouped = useMemo(() => {
		return filtered.reduce<Record<string, Report[]>>((acc, report) => {
			let domain: string;
			try {
				domain = new URL(report.url).origin;
			} catch {
				domain = "Unknown";
			}
			if (!acc[domain]) acc[domain] = [];
			acc[domain].push(report);
			return acc;
		}, {});
	}, [filtered]);

	// Stats computed from ALL reports (unfiltered) for stable header counts
	const stats = useMemo(() => {
		let totalAnnotations = 0;
		const typeCounts: Record<string, number> = {};
		const domainSet = new Set<string>();
		for (const r of reports) {
			try {
				domainSet.add(new URL(r.url).origin);
			} catch {
				domainSet.add("Unknown");
			}
			const anns = (r.payload as any)?.annotations ?? [];
			totalAnnotations += anns.length;
			for (const a of anns) {
				typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1;
			}
		}
		return { totalAnnotations, typeCounts, totalReports: reports.length, domains: domainSet.size };
	}, [reports]);

	return {
		filtered,
		grouped,
		stats,
		search,
		setSearch,
		typeFilter,
		setTypeFilter,
		loading,
		error,
		refresh,
	};
}

export function getTimeAgo(date: Date): string {
	const now = Date.now();
	const diff = now - date.getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
