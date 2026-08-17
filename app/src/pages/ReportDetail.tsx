import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useReport, getTimeAgo } from "../lib/hooks";
import { api } from "../lib/api";

const TYPE_COLORS: Record<string, { dot: string; text: string }> = {
	element: { dot: "bg-accent", text: "text-accent" },
	drawing: { dot: "bg-emerald", text: "text-emerald" },
	screenshot: { dot: "bg-cyan", text: "text-cyan" },
	marker: { dot: "bg-rose", text: "text-rose" },
	text: { dot: "bg-amber", text: "text-amber" },
};

const TYPE_LABELS: Record<string, string> = {
	element: "Element",
	drawing: "Drawing",
	screenshot: "Screenshot",
	marker: "Marker",
	text: "Text",
};

export function ReportDetailPage() {
	const { id } = useParams<{ id: string }>();
	const { report, loading, error, refresh } = useReport(id);
	const navigate = useNavigate();
	const [commentText, setCommentText] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmDeleteReport, setConfirmDeleteReport] = useState(false);
	const [confirmDeleteComment, setConfirmDeleteComment] = useState<string | null>(null);
	const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(toastTimer.current), []);
	const showToast = useCallback((msg: string) => {
		clearTimeout(toastTimer.current);
		setToast(msg);
		toastTimer.current = setTimeout(() => setToast(null), 2000);
	}, []);

	const addComment = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!commentText.trim() || !id) return;
			setSubmitting(true);
			try {
				await api(`/reports/${id}/comments`, {
					method: "POST",
					body: JSON.stringify({ text: commentText.trim() }),
				});
				setCommentText("");
				refresh();
			} catch (err) {
				showToast(err instanceof Error ? err.message : "Failed to add comment");
			} finally {
				setSubmitting(false);
			}
		},
		[commentText, id, refresh, showToast],
	);

	const deleteReport = useCallback(async () => {
		if (!id) return;
		setDeleting(true);
		try {
			await api(`/reports/${id}`, { method: "DELETE" });
			navigate("/dashboard");
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Failed to delete report");
			setConfirmDeleteReport(false);
		} finally {
			setDeleting(false);
		}
	}, [id, navigate, showToast]);

	const copyPrompt = useCallback(() => {
		const prompt = (report?.payload as any)?.prompt;
		if (!prompt) return;
		navigator.clipboard
			.writeText(prompt)
			.then(() => showToast("Prompt copied to clipboard"))
			.catch(() => showToast("Failed to copy prompt"));
	}, [report, showToast]);

	const copyReportUrl = useCallback(() => {
		navigator.clipboard
			.writeText(window.location.href)
			.then(() => showToast("Link copied to clipboard"))
			.catch(() => showToast("Failed to copy link"));
	}, [showToast]);

	const deleteComment = useCallback(
		async (commentId: string) => {
			try {
				await api(`/comments/${commentId}`, { method: "DELETE" });
				setConfirmDeleteComment(null);
				refresh();
			} catch (err) {
				showToast(err instanceof Error ? err.message : "Failed to delete comment");
			}
		},
		[refresh, showToast],
	);

	// Document title
	useEffect(() => {
		document.title = report ? `${report.title || "Report"} – devbar.sh` : "Report – devbar.sh";
	}, [report]);

	// Close lightbox on Escape
	useEffect(() => {
		if (!lightboxSrc) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setLightboxSrc(null);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [lightboxSrc]);

	if (loading) {
		return (
			<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
				<div className="flex items-center gap-2 mb-6">
					<div className="skeleton w-16 h-4" />
					<div className="skeleton w-4 h-4" />
					<div className="skeleton w-40 h-4" />
				</div>
				<div className="space-y-4">
					{[1, 2, 3].map((i) => (
						<div key={i} className="bg-bg-card border border-border rounded-xl p-5">
							<div className="flex items-center gap-3 mb-4">
								<div className="skeleton w-2 h-2 rounded-full" />
								<div className="skeleton w-20 h-4" />
								<div className="skeleton w-8 h-4" />
							</div>
							<div className="space-y-2">
								<div className="skeleton w-full h-3" />
								<div className="skeleton w-3/4 h-3" />
								<div className="skeleton w-1/2 h-3" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center fade-up">
					<div className="w-12 h-12 rounded-full bg-rose/10 flex items-center justify-center mx-auto mb-4">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-rose">
							<circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
							<path
								d="M10 6.5v4M10 13.5v.01"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</div>
					<p className="text-[15px] font-medium text-fg mb-1">Failed to load report</p>
					<p className="text-[14px] text-muted mb-4">{error}</p>
					<button onClick={refresh} className="btn-secondary">
						Try again
					</button>
				</div>
			</div>
		);
	}

	if (!report) return null;

	const payload = report.payload as any;
	const annotations = payload?.annotations ?? [];

	let path: string;
	try {
		const u = new URL(report.url);
		path = u.pathname + u.search;
	} catch {
		path = report.url;
	}

	const createdDate = new Date(report.createdAt);

	return (
		<div className="h-full flex flex-col">
			{/* Lightbox */}
			{lightboxSrc && (
				<div
					role="dialog"
					aria-label="Image preview"
					className="lightbox-backdrop fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 sm:p-10"
					onClick={() => setLightboxSrc(null)}
				>
					<button
						onClick={(e) => {
							e.stopPropagation();
							setLightboxSrc(null);
						}}
						aria-label="Close lightbox"
						className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<path
								d="M4 4l6 6M10 4l-6 6"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
					<img
						src={lightboxSrc}
						alt="Enlarged annotation screenshot"
						className="lightbox-image max-w-full max-h-full rounded-lg shadow-2xl cursor-default"
						onClick={(e) => e.stopPropagation()}
					/>
				</div>
			)}

			{/* Toast */}
			{toast && <div className="toast">{toast}</div>}

			{/* Header */}
			<div className="px-6 sm:px-10 py-5 border-b border-border shrink-0 bg-bg-card fade-up">
				<div className="flex items-center gap-2 text-[14px] mb-2">
					<Link
						to="/dashboard"
						className="text-muted hover:text-fg transition-colors flex items-center gap-1.5"
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
							<path
								d="M8.5 3.5L5 7l3.5 3.5"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						Reports
					</Link>
					<span className="text-border">/</span>
					<span className="text-fg font-medium truncate">{report.title || path}</span>
				</div>
				<div className="flex items-center gap-4 flex-wrap">
					<span className="text-[13px] text-muted font-mono truncate max-w-xs">{path}</span>
					{payload?.label && (
						<span className="text-[12px] px-2 py-0.5 rounded-full bg-accent-dim text-accent font-medium">
							{payload.label}
						</span>
					)}
					<span
						className="text-[13px] text-muted tabular-nums"
						title={createdDate.toLocaleString()}
					>
						{getTimeAgo(createdDate)}
					</span>
					{report.authorName && (
						<span className="text-[13px] text-muted flex items-center gap-1.5">
							{report.authorAvatar ? (
								<img src={report.authorAvatar} alt="" className="w-4 h-4 rounded-full" />
							) : (
								<span className="w-4 h-4 rounded-full bg-fg text-bg-card flex items-center justify-center text-[8px] font-bold shrink-0">
									{report.authorName.charAt(0).toUpperCase()}
								</span>
							)}
							{report.authorName}
						</span>
					)}
					<div className="ml-auto flex items-center gap-2">
						<a
							href={report.url}
							target="_blank"
							rel="noopener noreferrer"
							className="btn-secondary text-[13px]"
							title="Open original page"
						>
							<ExternalIcon /> <span className="hidden sm:inline">Open URL</span>
						</a>
						<button
							onClick={copyReportUrl}
							className="btn-secondary text-[13px]"
							title="Copy link to this report"
						>
							<LinkIcon /> <span className="hidden sm:inline">Share</span>
						</button>
						{payload?.prompt && (
							<button
								onClick={copyPrompt}
								className="btn-secondary text-[13px]"
								title="Copy prompt"
							>
								<CopyIcon /> <span className="hidden sm:inline">Copy prompt</span>
							</button>
						)}
						{confirmDeleteReport ? (
							<span className="inline-flex items-center gap-1.5 text-[13px]">
								<span className="text-rose font-medium">Delete?</span>
								<button
									onClick={deleteReport}
									disabled={deleting}
									className="btn-secondary text-[13px] text-rose border-rose/30 bg-rose/5 hover:bg-rose/10"
								>
									{deleting ? "..." : "Yes"}
								</button>
								<button
									onClick={() => setConfirmDeleteReport(false)}
									className="btn-secondary text-[13px]"
								>
									No
								</button>
							</span>
						) : (
							<button
								onClick={() => setConfirmDeleteReport(true)}
								className="btn-secondary text-[13px] text-rose border-border hover:border-rose/30 hover:bg-rose/5"
								title="Delete report"
							>
								<TrashIcon /> <span className="hidden sm:inline">Delete</span>
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Split view — stacks on mobile */}
			<div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
				{/* Left: Annotations */}
				<div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-4 fade-up fade-up-1">
					<div className="flex items-center justify-between mb-1">
						<h2 className="text-[13px] font-semibold text-muted uppercase tracking-wider">
							Annotations ({annotations.length})
						</h2>
					</div>
					{annotations.length === 0 ? (
						<div className="border border-border border-dashed rounded-xl py-14 text-center">
							<p className="text-[15px] text-muted">No annotations in this report</p>
						</div>
					) : (
						annotations.map((ann: any, i: number) => (
							<AnnotationCard
								key={ann.id ?? i}
								annotation={ann}
								index={i}
								onImageClick={setLightboxSrc}
							/>
						))
					)}
				</div>

				{/* Right: Metadata + Comments */}
				<div className="lg:w-[380px] shrink-0 overflow-y-auto flex flex-col border-t lg:border-t-0 lg:border-l border-border bg-bg-card fade-up fade-up-2">
					{/* Metadata */}
					<div className="p-6 border-b border-border">
						<h3 className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-4">
							Page Info
						</h3>
						<div className="space-y-3">
							<MetaRow label="URL" value={report.url} mono />
							<MetaRow label="Title" value={report.title} />
							{payload?.viewport && (
								<MetaRow
									label="Viewport"
									value={`${payload.viewport.width} x ${payload.viewport.height}`}
									mono
								/>
							)}
							{payload?.userAgent && <MetaRow label="User Agent" value={payload.userAgent} mono />}
							{payload?.route && (
								<>
									<MetaRow label="Pathname" value={payload.route.pathname} mono />
									{payload.route.search && (
										<MetaRow label="Search" value={payload.route.search} mono />
									)}
								</>
							)}
							{payload?.label && <MetaRow label="Label" value={payload.label} />}
							<MetaRow label="Annotations" value={`${annotations.length}`} />
						</div>
					</div>

					{/* Comments */}
					<div className="flex-1 flex flex-col p-6">
						<h3 className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-4">
							Comments ({report.comments.length})
						</h3>
						<div className="flex-1 space-y-4 mb-5">
							{report.comments.map((c) => (
								<div key={c.id} className="group">
									<div className="flex items-center gap-2 mb-1">
										<span className="text-[14px] font-medium text-fg">
											{c.authorName ?? "Anonymous"}
										</span>
										<span
											className="text-[12px] text-muted tabular-nums"
											title={new Date(c.createdAt).toLocaleString()}
										>
											{getTimeAgo(new Date(c.createdAt))}
										</span>
										{confirmDeleteComment === c.id ? (
											<span className="ml-auto flex items-center gap-1.5 text-[12px]">
												<button
													onClick={() => deleteComment(c.id)}
													className="text-rose font-medium hover:underline cursor-pointer"
												>
													Delete
												</button>
												<button
													onClick={() => setConfirmDeleteComment(null)}
													className="text-muted hover:text-fg cursor-pointer"
												>
													Cancel
												</button>
											</span>
										) : (
											<button
												onClick={() => setConfirmDeleteComment(c.id)}
												className="ml-auto opacity-0 group-hover:opacity-100 text-muted hover:text-rose transition-all cursor-pointer"
												title="Delete comment"
												aria-label="Delete comment"
											>
												<svg width="12" height="12" viewBox="0 0 14 14" fill="none">
													<path
														d="M4 4l6 6M10 4l-6 6"
														stroke="currentColor"
														strokeWidth="1.3"
														strokeLinecap="round"
													/>
												</svg>
											</button>
										)}
									</div>
									<p className="text-[14px] text-dim leading-relaxed">{c.text}</p>
								</div>
							))}
							{report.comments.length === 0 && (
								<p className="text-[14px] text-muted/50 italic">No comments yet</p>
							)}
						</div>
						<form onSubmit={addComment} className="flex gap-2">
							<input
								type="text"
								value={commentText}
								onChange={(e) => setCommentText(e.target.value)}
								placeholder="Add a comment..."
								className="input-field flex-1"
							/>
							<button
								type="submit"
								disabled={submitting || !commentText.trim()}
								className="btn-primary !px-4 shrink-0"
							>
								Send
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}

function AnnotationCard({
	annotation,
	index,
	onImageClick,
}: {
	annotation: any;
	index: number;
	onImageClick: (src: string) => void;
}) {
	const { type, data, comments: annComments } = annotation;
	const [expanded, setExpanded] = useState(true);
	const colors = TYPE_COLORS[type] ?? { dot: "bg-muted", text: "text-muted" };
	const label = TYPE_LABELS[type] ?? type;

	return (
		<div className="bg-bg-card border border-border rounded-xl overflow-hidden hover:border-dim/20 transition-colors shadow-sm">
			{/* Header */}
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-bg-hover transition-colors cursor-pointer"
			>
				<span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
				<span className={`text-[13px] font-semibold ${colors.text}`}>{label}</span>
				<span className="text-[13px] text-muted font-mono">#{index + 1}</span>
				{annComments?.length > 0 && (
					<span className="text-[13px] text-muted italic truncate ml-1 flex-1 text-left">
						"{annComments[0].text}"
					</span>
				)}
				<svg
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					className={`text-muted transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
				>
					<path
						d="M4 5.5L7 8.5L10 5.5"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>

			{expanded && (
				<div className="expand-content">
					{/* Visual */}
					{(type === "screenshot" || type === "drawing") && data?.imageDataUri && (
						<div className="bg-bg p-3 border-t border-border">
							<img
								src={data.imageDataUri}
								alt={type}
								className="max-w-full rounded-lg img-zoom border border-border"
								onClick={() => onImageClick(data.imageDataUri)}
							/>
						</div>
					)}
					{type === "drawing" && data?.screenshotDataUri && (
						<div className="bg-bg p-3 border-t border-border">
							<p className="text-[12px] text-muted mb-2 font-medium">Context screenshot</p>
							<img
								src={data.screenshotDataUri}
								alt="context"
								className="max-w-full rounded-lg opacity-70 img-zoom border border-border"
								onClick={() => onImageClick(data.screenshotDataUri)}
							/>
						</div>
					)}

					{/* Data */}
					<div className="px-5 py-4 space-y-2.5 border-t border-border">
						{type === "element" && data && <ElementData data={data} />}
						{type === "marker" && data && <MarkerData data={data} />}
						{type === "text" && data && <TextData data={data} />}
						{type === "screenshot" && data && <ScreenshotData data={data} />}
						{type === "drawing" && data && (
							<MetaRow
								label="Dimensions"
								value={`${data.dimensions?.width ?? "?"}x${data.dimensions?.height ?? "?"}`}
								mono
							/>
						)}
					</div>

					{/* Inline comments */}
					{annComments?.length > 0 && (
						<div className="px-5 py-3 border-t border-border bg-bg">
							{annComments.map((c: any, ci: number) => (
								<div key={ci} className="flex items-start gap-2 py-1">
									<span className="text-[12px] font-semibold text-dim shrink-0 mt-px">
										{c.author ?? "Note"}:
									</span>
									<span className="text-[14px] text-dim leading-relaxed">{c.text}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ElementData({ data }: { data: any }) {
	const [showStyles, setShowStyles] = useState(false);
	const [showHTML, setShowHTML] = useState(false);

	return (
		<>
			{data.tagName && (
				<MetaRow
					label="Element"
					value={`<${data.tagName}${data.id ? ` id="${data.id}"` : ""}>`}
					mono
				/>
			)}
			{data.xpath && <MetaRow label="XPath" value={data.xpath} mono copyable />}
			{data.cssSelector && <MetaRow label="CSS Selector" value={data.cssSelector} mono copyable />}
			{data.classes?.length > 0 && <MetaRow label="Classes" value={data.classes.join(" ")} mono />}
			{data.innerText && (
				<MetaRow
					label="Text"
					value={
						data.innerText.length > 120 ? data.innerText.slice(0, 120) + "..." : data.innerText
					}
				/>
			)}
			{data.boundingRect && (
				<MetaRow
					label="Rect"
					value={`${data.boundingRect.width}x${data.boundingRect.height} at (${Math.round(data.boundingRect.x)}, ${Math.round(data.boundingRect.y)})`}
					mono
				/>
			)}

			{data.computedStyles && (
				<div>
					<button
						onClick={() => setShowStyles(!showStyles)}
						className="flex items-center gap-1.5 text-[13px] text-muted hover:text-fg transition-colors cursor-pointer py-1"
					>
						<TriangleIcon open={showStyles} />
						Computed Styles ({Object.keys(data.computedStyles).length})
					</button>
					{showStyles && (
						<div className="expand-content bg-bg-code rounded-lg p-3 font-mono text-[12px] text-dim leading-[1.9] max-h-48 overflow-y-auto mt-1 border border-border">
							{Object.entries(data.computedStyles).map(([k, v]) => (
								<div key={k}>
									<span className="text-accent">{k}</span>
									<span className="text-muted">: </span>
									<span>{String(v)}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{data.reactContext && (
				<div>
					<p className="text-[13px] text-muted mb-2 font-medium">React Component Tree</p>
					<div className="bg-bg-code rounded-lg p-3 font-mono text-[12px] leading-[1.9] border border-border">
						<p className="text-emerald mb-1">{data.reactContext.componentPath}</p>
						{data.reactContext.components?.map((comp: any, ci: number) => (
							<div key={ci} className="ml-3 border-l-2 border-border pl-3 mt-1">
								<span className="text-accent">
									{"<"}
									{comp.name}
									{">"}
								</span>
								{comp.source && (
									<span className="text-muted ml-2 text-[11px]">
										{comp.source.fileName}:{comp.source.lineNumber}
									</span>
								)}
								{comp.props && (
									<div className="text-muted ml-2">
										{Object.entries(comp.props)
											.slice(0, 5)
											.map(([k, v]) => (
												<span key={k} className="mr-2">
													{k}={JSON.stringify(v)}
												</span>
											))}
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{data.outerHTML && (
				<div>
					<button
						onClick={() => setShowHTML(!showHTML)}
						className="flex items-center gap-1.5 text-[13px] text-muted hover:text-fg transition-colors cursor-pointer py-1"
					>
						<TriangleIcon open={showHTML} />
						HTML
					</button>
					{showHTML && (
						<div className="expand-content bg-bg-code rounded-lg p-3 font-mono text-[12px] text-dim leading-[1.7] max-h-40 overflow-y-auto mt-1 break-all border border-border">
							{data.outerHTML}
						</div>
					)}
				</div>
			)}
		</>
	);
}

function MarkerData({ data }: { data: any }) {
	return (
		<>
			<div className="flex items-center gap-2.5">
				<span
					className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
					style={{ backgroundColor: data.color ?? "#e11d48" }}
				>
					{data.number}
				</span>
				<span className="text-[14px] text-fg font-medium">Marker #{data.number}</span>
			</div>
			{data.position && (
				<MetaRow
					label="Position"
					value={`(${Math.round(data.position.x)}, ${Math.round(data.position.y)})`}
					mono
				/>
			)}
			{data.nearestElementXPath && (
				<MetaRow label="Nearest XPath" value={data.nearestElementXPath} mono copyable />
			)}
			{data.nearestElementCssSelector && (
				<MetaRow label="Nearest Selector" value={data.nearestElementCssSelector} mono copyable />
			)}
			{data.nearestReactContext && (
				<MetaRow label="React Path" value={data.nearestReactContext.componentPath} mono />
			)}
		</>
	);
}

function TextData({ data }: { data: any }) {
	return (
		<>
			<MetaRow label="Text" value={data.text} />
			{data.position && (
				<MetaRow
					label="Position"
					value={`(${Math.round(data.position.x)}, ${Math.round(data.position.y)})`}
					mono
				/>
			)}
			{data.nearestElementXPath && (
				<MetaRow label="Near XPath" value={data.nearestElementXPath} mono />
			)}
			{data.nearestElementCssSelector && (
				<MetaRow label="Near Selector" value={data.nearestElementCssSelector} mono />
			)}
			{data.nearestReactContext && (
				<MetaRow label="React Path" value={data.nearestReactContext.componentPath} mono />
			)}
		</>
	);
}

function ScreenshotData({ data }: { data: any }) {
	return (
		<>
			{data.region && (
				<MetaRow
					label="Region"
					value={`${data.region.width}x${data.region.height} at (${data.region.x}, ${data.region.y})`}
					mono
				/>
			)}
			<MetaRow label="Full Page" value={data.fullPage ? "Yes" : "No"} />
		</>
	);
}

function MetaRow({
	label,
	value,
	mono,
	copyable,
}: {
	label: string;
	value: string;
	mono?: boolean;
	copyable?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(copyTimer.current), []);
	const handleCopy = () => {
		navigator.clipboard
			.writeText(value)
			.then(() => {
				clearTimeout(copyTimer.current);
				setCopied(true);
				copyTimer.current = setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {
				/* clipboard write can fail in insecure contexts — silently ignore */
			});
	};

	return (
		<div className="flex items-start gap-4 group/meta">
			<span className="text-[13px] text-muted shrink-0 w-28">{label}</span>
			<span
				className={`text-[13px] text-fg break-all leading-relaxed flex-1 ${mono ? "font-mono text-[12px]" : ""}`}
			>
				{value}
			</span>
			{copyable && (
				<button
					onClick={handleCopy}
					className="opacity-0 group-hover/meta:opacity-100 text-muted hover:text-accent transition-all cursor-pointer shrink-0 mt-0.5"
					title="Copy"
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
				</button>
			)}
		</div>
	);
}

function TriangleIcon({ open }: { open: boolean }) {
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			className={`transition-transform ${open ? "rotate-90" : ""}`}
		>
			<path
				d="M3.5 2L7 5L3.5 8"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function CopyIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<rect x="5" y="5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
			<path
				d="M9 5V3.5A1.5 1.5 0 007.5 2H3.5A1.5 1.5 0 002 3.5V7.5A1.5 1.5 0 003.5 9H5"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-emerald">
			<path
				d="M3 7.5L6 10.5L11 4"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
			<path
				d="M2.5 4h9M5.5 4V2.5a1 1 0 011-1h1a1 1 0 011 1V4M6 6.5v3.5M8 6.5v3.5M3.5 4l.5 7.5a1 1 0 001 1h4a1 1 0 001-1L10.5 4"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function LinkIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
			<path
				d="M6 8l2-2M5.5 9.5l-1 1a2.12 2.12 0 01-3-3l1-1M8.5 4.5l1-1a2.12 2.12 0 013 3l-1 1"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ExternalIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 14 14" fill="none">
			<path
				d="M11 7.5V11a1.5 1.5 0 01-1.5 1.5H3A1.5 1.5 0 011.5 11V4.5A1.5 1.5 0 013 3h3.5M8.5 1.5H12.5V5.5M6 8l6.5-6.5"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
