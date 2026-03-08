import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { auth } from "../lib/auth";
import type { DashboardContext } from "../lib/hooks";

export function OrgSettingsPage() {
	const { activeOrg } = useOutletContext<DashboardContext>();
	const [searchParams, setSearchParams] = useSearchParams();
	const showCreate = searchParams.get("create") === "1";

	useEffect(() => {
		document.title = activeOrg ? `${activeOrg.name} – Settings` : "Organization – deloop.dev";
	}, [activeOrg]);

	if (showCreate || !activeOrg) {
		return <CreateOrg onDone={() => setSearchParams({})} />;
	}

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			<h1 className="text-[24px] font-semibold tracking-tight mb-1">Organization</h1>
			<p className="text-[15px] text-muted mb-8">Manage {activeOrg.name}</p>

			<OrgInfo org={activeOrg} />
			<Members orgId={activeOrg.id} />
			<InviteMember orgId={activeOrg.id} />
		</div>
	);
}

function CreateOrg({ onDone }: { onDone: () => void }) {
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setLoading(true);
			setError(null);
			try {
				const computedSlug = slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
				const result = await auth.organization.create({
					name: name.trim(),
					slug: computedSlug,
				});
				if (result.error) {
					setError(result.error.message ?? "Failed to create organization");
					return;
				}
				// better-auth automatically sets newly created org as active,
				// so no separate setActive call needed.
				// Reload to let Layout hooks pick up the new org list + active org.
				window.location.href = "/dashboard/settings/org";
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setLoading(false);
			}
		},
		[name, slug],
	);

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			<h1 className="text-[24px] font-semibold tracking-tight mb-1">Create Organization</h1>
			<p className="text-[15px] text-muted mb-8">Set up a workspace for your team</p>
			<div className="bg-bg-card border border-border rounded-xl p-6">
				<form onSubmit={handleCreate} className="space-y-5">
					<div>
						<label className="text-[13px] font-medium text-dim block mb-1.5">Name</label>
						<input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="My Team" className="input-field" />
					</div>
					<div>
						<label className="text-[13px] font-medium text-dim block mb-1.5">Slug (optional)</label>
						<input
							type="text"
							value={slug}
							onChange={(e) => setSlug(e.target.value)}
							placeholder={name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "my-team"}
							className="input-field"
						/>
						<p className="text-[12px] text-muted mt-1">URL-friendly identifier. Auto-generated from name if left blank.</p>
					</div>
					{error && <div className="px-3 py-2.5 bg-rose/5 border border-rose/15 rounded-lg"><p className="text-[13px] text-rose">{error}</p></div>}
					<button type="submit" disabled={loading || !name.trim()} className="btn-primary w-full !py-2.5">
						{loading ? "Creating..." : "Create Organization"}
					</button>
				</form>
			</div>
		</div>
	);
}

function OrgInfo({ org }: { org: { id: string; name: string; slug: string } }) {
	return (
		<div className="bg-bg-card border border-border rounded-xl p-5 mb-8 flex items-center gap-4">
			<div className="w-11 h-11 rounded-lg bg-fg text-bg-card flex items-center justify-center text-[15px] font-bold">
				{org.name.charAt(0).toUpperCase()}
			</div>
			<div>
				<p className="text-[15px] font-medium">{org.name}</p>
				<p className="text-[13px] text-muted font-mono">{org.slug}</p>
			</div>
		</div>
	);
}

function Members({ orgId }: { orgId: string }) {
	const [members, setMembers] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		auth.organization
			.getFullOrganization({ query: { organizationId: orgId } })
			.then((res) => {
				if (res.error) {
					setError(res.error.message ?? "Failed to load members");
					return;
				}
				setMembers(res.data?.members ?? []);
			})
			.catch((err) => setError(err instanceof Error ? err.message : "Failed to load members"))
			.finally(() => setLoading(false));
	}, [orgId]);

	return (
		<div className="mb-8">
			<h2 className="text-[15px] font-semibold mb-3">Members ({loading ? "..." : members.length})</h2>
			{error && (
				<div className="error-banner mb-3">
					<span>{error}</span>
				</div>
			)}
			{loading ? (
				<div className="bg-bg-card border border-border rounded-xl p-5">
					<div className="space-y-3">
						{[1, 2].map((i) => (
							<div key={i} className="flex items-center gap-3.5">
								<div className="skeleton w-8 h-8 rounded-full" />
								<div className="flex-1 space-y-1.5">
									<div className="skeleton w-28 h-3.5" />
									<div className="skeleton w-40 h-3" />
								</div>
							</div>
						))}
					</div>
				</div>
			) : members.length === 0 ? (
				<p className="text-[14px] text-muted py-4">No members found.</p>
			) : (
				<div className="bg-bg-card border border-border rounded-xl overflow-hidden">
					{members.map((m: any, i: number) => (
						<div key={m.id} className={`flex items-center gap-3.5 px-5 py-3.5 ${i < members.length - 1 ? "border-b border-border" : ""}`}>
							{m.user?.image ? (
								<img src={m.user.image} alt="" className="w-8 h-8 rounded-full" />
							) : (
								<div className="w-8 h-8 rounded-full bg-fg text-bg-card flex items-center justify-center text-[11px] font-bold">
									{(m.user?.name ?? m.user?.email ?? "?").charAt(0).toUpperCase()}
								</div>
							)}
							<div className="min-w-0 flex-1">
								<p className="text-[14px] font-medium truncate">{m.user?.name ?? m.user?.email}</p>
								<p className="text-[13px] text-muted truncate">{m.user?.email}</p>
							</div>
							<span className="text-[12px] text-muted capitalize px-2.5 py-1 bg-bg rounded-full font-medium border border-border">{m.role}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function InviteMember({ orgId }: { orgId: string }) {
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleInvite = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!email.trim()) return;
			setLoading(true);
			setError(null);
			setSuccess(false);
			try {
				const result = await auth.organization.inviteMember({
					email: email.trim(),
					role: "member",
					organizationId: orgId,
				});
				if (result.error) {
					setError(result.error.message ?? "Failed to invite");
					return;
				}
				setSuccess(true);
				setEmail("");
				setTimeout(() => setSuccess(false), 3000);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setLoading(false);
			}
		},
		[email, orgId],
	);

	return (
		<div>
			<h2 className="text-[15px] font-semibold mb-3">Invite Member</h2>
			<form onSubmit={handleInvite} className="flex gap-2">
				<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" className="input-field flex-1" />
				<button type="submit" disabled={loading || !email.trim()} className="btn-primary shrink-0">{loading ? "..." : "Invite"}</button>
			</form>
			{error && <p className="text-[13px] text-rose mt-2">{error}</p>}
			{success && <p className="text-[13px] text-emerald mt-2">Invitation sent!</p>}
		</div>
	);
}
