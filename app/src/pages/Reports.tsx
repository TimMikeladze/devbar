import { useEffect, useRef } from "react";
import { Link, useOutletContext } from "react-router";
import { useFilteredReports, getTimeAgo, type Report, type DashboardContext } from "../lib/hooks";

const TYPE_META: Record<string, { label: string; color: string; dotColor: string }> = {
	element: { label: "Elements", color: "text-accent", dotColor: "bg-accent" },
	drawing: { label: "Drawings", color: "text-emerald", dotColor: "bg-emerald" },
	screenshot: { label: "Screenshots", color: "text-cyan", dotColor: "bg-cyan" },
	marker: { label: "Markers", color: "text-rose", dotColor: "bg-rose" },
	text: { label: "Text", color: "text-amber", dotColor: "bg-amber" },
};

export function ReportsPage() {
	const { activeOrg } = useOutletContext<DashboardContext>();
	const { filtered, grouped, stats, search, setSearch, typeFilter, setTypeFilter, loading, error, refresh } =
		useFilteredReports(activeOrg?.id);
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		document.title = activeOrg ? `Reports – ${activeOrg.name}` : "Reports – deloop.dev";
	}, [activeOrg]);

	// "/" keyboard shortcut to focus search
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "/" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT") {
				e.preventDefault();
				searchRef.current?.focus();
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, []);

	if (!activeOrg) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center py-20 fade-up">
					<div className="w-12 h-12 rounded-full bg-bg-hover flex items-center justify-center mx-auto mb-4">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-muted">
							<path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</div>
					<p className="text-[15px] font-medium text-fg">No organization selected</p>
					<p className="text-[14px] text-muted mt-1">Create or join one to get started.</p>
				</div>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
				<div className="mb-8">
					<div className="skeleton w-32 h-7 mb-2" />
					<div className="skeleton w-48 h-4" />
				</div>
				<div className="space-y-3">
					{[1, 2, 3, 4, 5].map((i) => (
						<div key={i} className="bg-bg-card border border-border rounded-xl px-5 py-4">
							<div className="flex items-center gap-4">
								<div className="flex-1">
									<div className="skeleton w-48 h-4 mb-2" />
									<div className="skeleton w-32 h-3" />
								</div>
								<div className="skeleton w-12 h-3" />
								<div className="skeleton w-16 h-3" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	const domains = Object.keys(grouped).sort();

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			{/* Header */}
			<div className="mb-8">
				<h1 className="text-[24px] font-semibold tracking-tight text-fg">Reports</h1>
				<p className="text-[15px] text-muted mt-1">
					{stats.totalReports} report{stats.totalReports !== 1 ? "s" : ""} across{" "}
					{stats.domains} domain{stats.domains !== 1 ? "s" : ""}
				</p>
			</div>

			{/* Error banner */}
			{error && (
				<div className="error-banner mb-6">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
						<circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
						<path d="M7 4.5v3M7 9.5v.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
					</svg>
					<span>Failed to load reports: {error}</span>
					<button onClick={refresh}>Retry</button>
				</div>
			)}

			{/* Stats & filters */}
			{stats.totalReports > 0 && (
				<div className="flex items-center gap-6 mb-6 pb-6 border-b border-border flex-wrap">
					<div className="flex items-center gap-2">
						<span className="text-[18px] font-semibold tabular-nums">{stats.totalAnnotations}</span>
						<span className="text-[14px] text-muted">annotations</span>
					</div>
					<div className="w-px h-5 bg-border" />
					{Object.entries(stats.typeCounts)
						.sort(([, a], [, b]) => b - a)
						.map(([type, count]) => {
							const meta = TYPE_META[type];
							if (!meta) return null;
							return (
								<button
									key={type}
									onClick={() => setTypeFilter(typeFilter === type ? null : type)}
									className={`flex items-center gap-2 text-[14px] transition-colors cursor-pointer rounded-lg px-2.5 py-1 ${
										typeFilter === type ? "bg-bg-hover text-fg font-medium shadow-sm" : "text-muted hover:text-fg"
									}`}
								>
									<span className={`w-2 h-2 rounded-full ${meta.dotColor}`} />
									<span className="tabular-nums">{count}</span>
									<span>{meta.label.toLowerCase()}</span>
								</button>
							);
						})}
					{typeFilter && (
						<button onClick={() => setTypeFilter(null)} className="text-[13px] text-accent hover:underline cursor-pointer ml-auto">
							Clear filter
						</button>
					)}
				</div>
			)}

			{/* Search */}
			{stats.totalReports > 0 && (
				<div className="relative mb-6">
					<SearchIcon />
					<input
						ref={searchRef}
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search reports... (press /)"
						className="w-full pl-10 pr-4 py-2.5 bg-bg-card border border-border rounded-lg text-[14px] text-fg placeholder:text-muted/60 outline-none focus:border-fg focus:shadow-[0_0_0_1px_var(--color-fg)] transition-all"
					/>
					{search && (
						<button
							onClick={() => setSearch("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors cursor-pointer"
						>
							<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
								<path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
							</svg>
						</button>
					)}
				</div>
			)}

			{/* Content */}
			{filtered.length === 0 && stats.totalReports === 0 ? (
				<EmptyState />
			) : filtered.length === 0 ? (
				<div className="border border-border border-dashed rounded-xl py-14 text-center">
					<p className="text-[15px] text-muted">No reports match your search</p>
					<button onClick={() => { setSearch(""); setTypeFilter(null); }} className="text-[14px] text-accent mt-2 hover:underline cursor-pointer">
						Clear filters
					</button>
				</div>
			) : (
				<div className="space-y-8">
					{domains.map((domain, di) => (
						<DomainGroup key={domain} domain={domain} reports={grouped[domain]} delay={di} />
					))}
				</div>
			)}
		</div>
	);
}

function DomainGroup({ domain, reports, delay }: { domain: string; reports: Report[]; delay: number }) {
	let hostname: string;
	try { hostname = new URL(domain).hostname; } catch { hostname = domain; }

	return (
		<div className={`fade-up fade-up-${Math.min(delay + 1, 5)}`}>
			<div className="flex items-center gap-2 mb-3">
				<div className="w-5 h-5 rounded bg-fg text-bg-card flex items-center justify-center">
					<span className="text-[9px] font-bold">{hostname.charAt(0).toUpperCase()}</span>
				</div>
				<h2 className="text-[13px] font-medium text-muted">{hostname}</h2>
				<span className="text-[13px] text-muted/50 tabular-nums">{reports.length}</span>
			</div>
			<div className="bg-bg-card rounded-xl border border-border overflow-hidden">
				{reports.map((report, i) => (
					<ReportRow key={report.id} report={report} isLast={i === reports.length - 1} />
				))}
			</div>
		</div>
	);
}

function ReportRow({ report, isLast }: { report: Report; isLast: boolean }) {
	const payload = report.payload as any;
	const annotations = payload?.annotations ?? [];
	const createdDate = new Date(report.createdAt);
	const timeAgo = getTimeAgo(createdDate);

	let path: string;
	try { const u = new URL(report.url); path = u.pathname + u.search; } catch { path = report.url; }

	const typesPresent = [...new Set(annotations.map((a: any) => a.type as string))];

	return (
		<Link
			to={`/dashboard/reports/${report.id}`}
			className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 sm:py-4 hover:bg-bg-hover transition-colors group ${!isLast ? "border-b border-border" : ""}`}
		>
			<div className="min-w-0 flex-1">
				<p className="text-[14px] sm:text-[15px] font-medium text-fg truncate group-hover:text-accent transition-colors">
					{report.title || path}
				</p>
				<div className="flex items-center gap-2 sm:gap-3 mt-1 sm:mt-1.5">
					<span className="text-[12px] sm:text-[13px] text-muted font-mono truncate max-w-[180px] sm:max-w-[260px]">{path}</span>
					{payload?.label && (
						<span className="text-[11px] sm:text-[12px] px-2 py-0.5 rounded-full bg-accent-dim text-accent font-medium">
							{payload.label}
						</span>
					)}
				</div>
			</div>

			{/* Type dots */}
			<div className="flex items-center gap-1.5 shrink-0">
				{typesPresent.map((type) => {
					const meta = TYPE_META[type];
					if (!meta) return null;
					return <span key={type} title={meta.label} className={`w-2 h-2 rounded-full ${meta.dotColor}`} />;
				})}
			</div>

			<span className="text-[13px] text-muted tabular-nums shrink-0 hidden sm:inline">
				{annotations.length} ann.
			</span>

			{report.authorName && (
				<div className="shrink-0 hidden sm:block" title={report.authorName}>
					{report.authorAvatar ? (
						<img src={report.authorAvatar} alt="" className="w-6 h-6 rounded-full" />
					) : (
						<div className="w-6 h-6 rounded-full bg-fg text-bg-card flex items-center justify-center text-[10px] font-bold">
							{report.authorName.charAt(0).toUpperCase()}
						</div>
					)}
				</div>
			)}

			<span className="text-[12px] sm:text-[13px] text-muted tabular-nums shrink-0 sm:w-16 text-right" title={createdDate.toLocaleString()}>{timeAgo}</span>

			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-border group-hover:text-muted transition-colors shrink-0 hidden sm:block">
				<path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</Link>
	);
}

function EmptyState() {
	return (
		<div className="border border-border border-dashed rounded-xl py-20 text-center fade-up">
			<div className="w-14 h-14 rounded-full bg-bg-hover flex items-center justify-center mx-auto mb-5">
				<svg width="24" height="24" viewBox="0 0 20 20" fill="none" className="text-muted">
					<path d="M3 4.5A1.5 1.5 0 014.5 3h11A1.5 1.5 0 0117 4.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15.5v-11z" stroke="currentColor" strokeWidth="1.2" />
					<path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
				</svg>
			</div>
			<p className="text-[16px] font-medium text-fg">No reports yet</p>
			<p className="text-[14px] text-muted mt-2 max-w-[320px] mx-auto leading-relaxed">
				Reports will appear here when submitted via the deloop toolbar on your website.
			</p>
		</div>
	);
}

function SearchIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
			<circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
			<path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
		</svg>
	);
}
