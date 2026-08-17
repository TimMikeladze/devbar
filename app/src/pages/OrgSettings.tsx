import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { auth } from "../lib/auth";
import type { DashboardContext } from "../lib/hooks";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export function OrgSettingsPage() {
	const { activeOrg, user } = useOutletContext<DashboardContext>();
	const [searchParams, setSearchParams] = useSearchParams();
	const showCreate = searchParams.get("create") === "1";

	const [members, setMembers] = useState<any[]>([]);
	const [invitations, setInvitations] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchOrg = useCallback(() => {
		if (!activeOrg) return;
		setLoading(true);
		setError(null);
		auth.organization
			.getFullOrganization({ query: { organizationId: activeOrg.id } })
			.then((res) => {
				if (res.error) {
					setError(res.error.message ?? "Failed to load organization");
					return;
				}
				setMembers(res.data?.members ?? []);
				setInvitations(res.data?.invitations ?? []);
			})
			.catch((err) => setError(err instanceof Error ? err.message : "Failed to load organization"))
			.finally(() => setLoading(false));
	}, [activeOrg?.id]);

	useEffect(() => {
		fetchOrg();
	}, [fetchOrg]);

	useEffect(() => {
		document.title = activeOrg ? `${activeOrg.name} – Settings` : "Organization – devbar.sh";
	}, [activeOrg]);

	if (showCreate || !activeOrg) {
		return <CreateOrg onDone={() => setSearchParams({})} />;
	}

	const currentMember = members.find((m: any) => m.userId === user.id);
	const isOwner = currentMember?.role === "owner";
	const pendingInvites = invitations.filter((inv: any) => inv.status === "pending");

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			<h1 className="text-[24px] font-semibold tracking-tight mb-1">Organization</h1>
			<p className="text-[15px] text-muted mb-8">Manage {activeOrg.name}</p>

			<OrgInfo org={activeOrg} />
			{error && (
				<div className="error-banner mb-6">
					<span>{error}</span>
				</div>
			)}
			<Members
				members={members}
				loading={loading}
				currentUserId={user.id}
				isOwner={isOwner}
				orgId={activeOrg.id}
				onRefresh={fetchOrg}
			/>
			<PendingInvites
				invitations={pendingInvites}
				loading={loading}
				isOwner={isOwner}
				onRefresh={fetchOrg}
			/>
			<InviteMember orgId={activeOrg.id} onInvited={fetchOrg} />
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
				const computedSlug =
					slug.trim() ||
					name
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, "");
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
				onDone();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setLoading(false);
			}
		},
		[name, slug, onDone],
	);

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			<h1 className="text-[24px] font-semibold tracking-tight mb-1">Create Organization</h1>
			<p className="text-[15px] text-muted mb-8">Set up a workspace for your team</p>
			<div className="bg-bg-card border border-border rounded-xl p-6">
				<form onSubmit={handleCreate} className="space-y-5">
					<div>
						<label htmlFor="org-name" className="text-[13px] font-medium text-dim block mb-1.5">
							Name
						</label>
						<input
							id="org-name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							placeholder="My Team"
							className="input-field"
						/>
					</div>
					<div>
						<label htmlFor="org-slug" className="text-[13px] font-medium text-dim block mb-1.5">
							Slug (optional)
						</label>
						<input
							id="org-slug"
							type="text"
							value={slug}
							onChange={(e) => setSlug(e.target.value)}
							placeholder={
								name
									? name
											.toLowerCase()
											.replace(/[^a-z0-9]+/g, "-")
											.replace(/^-|-$/g, "")
									: "my-team"
							}
							className="input-field"
						/>
						<p className="text-[12px] text-muted mt-1">
							URL-friendly identifier. Auto-generated from name if left blank.
						</p>
					</div>
					{error && (
						<div className="px-3 py-2.5 bg-rose/5 border border-rose/15 rounded-lg">
							<p className="text-[13px] text-rose">{error}</p>
						</div>
					)}
					<button
						type="submit"
						disabled={loading || !name.trim()}
						className="btn-primary w-full !py-2.5"
					>
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

function Members({
	members,
	loading,
	currentUserId,
	isOwner,
	orgId,
	onRefresh,
}: {
	members: any[];
	loading: boolean;
	currentUserId: string;
	isOwner: boolean;
	orgId: string;
	onRefresh: () => void;
}) {
	const [busyId, setBusyId] = useState<string | null>(null);
	const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const handleRoleChange = useCallback(
		async (memberId: string, role: string) => {
			setBusyId(memberId);
			setActionError(null);
			try {
				const res = await auth.organization.updateMemberRole({
					memberId,
					role,
					organizationId: orgId,
				});
				if (res.error) {
					setActionError(res.error.message ?? "Failed to update role");
					return;
				}
				onRefresh();
			} catch (err) {
				setActionError(err instanceof Error ? err.message : "Failed to update role");
			} finally {
				setBusyId(null);
			}
		},
		[orgId, onRefresh],
	);

	const handleRemove = useCallback(
		async (memberId: string) => {
			setBusyId(memberId);
			setActionError(null);
			try {
				const res = await auth.organization.removeMember({
					memberIdOrEmail: memberId,
					organizationId: orgId,
				});
				if (res.error) {
					setActionError(res.error.message ?? "Failed to remove member");
					return;
				}
				setConfirmRemoveId(null);
				onRefresh();
			} catch (err) {
				setActionError(err instanceof Error ? err.message : "Failed to remove member");
			} finally {
				setBusyId(null);
			}
		},
		[orgId, onRefresh],
	);

	return (
		<div className="mb-8">
			<h2 className="text-[15px] font-semibold mb-3">
				Members ({loading ? "..." : members.length})
			</h2>
			{actionError && (
				<div className="error-banner mb-3">
					<span>{actionError}</span>
					<button onClick={() => setActionError(null)}>Dismiss</button>
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
					{members.map((m: any, i: number) => {
						const isSelf = m.userId === currentUserId;
						const isBusy = busyId === m.id;
						return (
							<div
								key={m.id}
								className={`flex items-center gap-3.5 px-5 py-3.5 ${i < members.length - 1 ? "border-b border-border" : ""}`}
							>
								{m.user?.image ? (
									<img src={m.user.image} alt="" className="w-8 h-8 rounded-full" />
								) : (
									<div className="w-8 h-8 rounded-full bg-fg text-bg-card flex items-center justify-center text-[11px] font-bold">
										{(m.user?.name ?? m.user?.email ?? "?").charAt(0).toUpperCase()}
									</div>
								)}
								<div className="min-w-0 flex-1">
									<p className="text-[14px] font-medium truncate">
										{m.user?.name ?? m.user?.email}
										{isSelf && (
											<span className="text-muted ml-1.5 text-[12px] font-normal">(you)</span>
										)}
									</p>
									<p className="text-[13px] text-muted truncate">{m.user?.email}</p>
								</div>
								{isOwner && !isSelf ? (
									<div className="flex items-center gap-2 shrink-0">
										<Select
											value={m.role}
											onValueChange={(val) => handleRoleChange(m.id, val)}
											disabled={isBusy}
										>
											<SelectTrigger size="sm" className="w-[100px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													<SelectItem value="owner">Owner</SelectItem>
													<SelectItem value="admin">Admin</SelectItem>
													<SelectItem value="member">Member</SelectItem>
												</SelectGroup>
											</SelectContent>
										</Select>
										{confirmRemoveId === m.id ? (
											<div className="flex items-center gap-1.5">
												<button
													onClick={() => handleRemove(m.id)}
													disabled={isBusy}
													className="text-[12px] font-medium text-rose hover:underline cursor-pointer"
												>
													{isBusy ? "..." : "Confirm"}
												</button>
												<button
													onClick={() => setConfirmRemoveId(null)}
													className="text-[12px] text-muted hover:underline cursor-pointer"
												>
													Cancel
												</button>
											</div>
										) : (
											<button
												onClick={() => setConfirmRemoveId(m.id)}
												className="text-[12px] text-muted hover:text-rose cursor-pointer transition-colors"
												title="Remove member"
											>
												Remove
											</button>
										)}
									</div>
								) : (
									<span className="text-[12px] text-muted capitalize px-2.5 py-1 bg-bg rounded-full font-medium border border-border">
										{m.role}
									</span>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function PendingInvites({
	invitations,
	loading,
	isOwner,
	onRefresh,
}: {
	invitations: any[];
	loading: boolean;
	isOwner: boolean;
	onRefresh: () => void;
}) {
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleCancel = useCallback(
		async (invitationId: string) => {
			setBusyId(invitationId);
			setError(null);
			try {
				const res = await auth.organization.cancelInvitation({ invitationId });
				if (res.error) {
					setError(res.error.message ?? "Failed to cancel invitation");
					return;
				}
				onRefresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to cancel invitation");
			} finally {
				setBusyId(null);
			}
		},
		[onRefresh],
	);

	if (loading) return null;
	if (invitations.length === 0) return null;

	return (
		<div className="mb-8">
			<h2 className="text-[15px] font-semibold mb-3">Pending Invites ({invitations.length})</h2>
			{error && (
				<div className="error-banner mb-3">
					<span>{error}</span>
					<button onClick={() => setError(null)}>Dismiss</button>
				</div>
			)}
			<div className="bg-bg-card border border-border rounded-xl overflow-hidden">
				{invitations.map((inv: any, i: number) => (
					<div
						key={inv.id}
						className={`flex items-center gap-3.5 px-5 py-3.5 ${i < invitations.length - 1 ? "border-b border-border" : ""}`}
					>
						<div className="w-8 h-8 rounded-full bg-bg border border-border flex items-center justify-center">
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className="text-muted"
							>
								<rect x="2" y="4" width="20" height="16" rx="2" />
								<path d="M22 7l-10 7L2 7" />
							</svg>
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-[14px] font-medium truncate">{inv.email}</p>
							<p className="text-[13px] text-muted">
								Invited as <span className="capitalize">{inv.role}</span>
							</p>
						</div>
						<span className="text-[12px] text-amber capitalize px-2.5 py-1 bg-amber/8 rounded-full font-medium border border-amber/15 shrink-0">
							Pending
						</span>
						{isOwner && (
							<button
								onClick={() => handleCancel(inv.id)}
								disabled={busyId === inv.id}
								className="text-[12px] text-muted hover:text-rose cursor-pointer transition-colors shrink-0"
							>
								{busyId === inv.id ? "..." : "Cancel"}
							</button>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function InviteMember({ orgId, onInvited }: { orgId: string; onInvited: () => void }) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"member" | "admin" | "owner">("member");
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const successTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(successTimer.current), []);

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
					role,
					organizationId: orgId,
				});
				if (result.error) {
					setError(result.error.message ?? "Failed to invite");
					return;
				}
				setSuccess(true);
				setEmail("");
				setRole("member");
				clearTimeout(successTimer.current);
				successTimer.current = setTimeout(() => setSuccess(false), 3000);
				onInvited();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setLoading(false);
			}
		},
		[email, role, orgId, onInvited],
	);

	return (
		<div>
			<h2 className="text-[15px] font-semibold mb-3">Invite Member</h2>
			<form onSubmit={handleInvite} className="flex gap-2">
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="colleague@company.com"
					className="input-field flex-1"
				/>
				<Select
					value={role}
					onValueChange={(val) => {
						if (val) setRole(val as "member" | "admin" | "owner");
					}}
				>
					<SelectTrigger size="sm" className="w-[100px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectItem value="member">Member</SelectItem>
							<SelectItem value="admin">Admin</SelectItem>
							<SelectItem value="owner">Owner</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
				<button type="submit" disabled={loading || !email.trim()} className="btn-primary shrink-0">
					{loading ? "..." : "Invite"}
				</button>
			</form>
			{error && <p className="text-[13px] text-rose mt-2">{error}</p>}
			{success && <p className="text-[13px] text-emerald mt-2">Invitation sent!</p>}
		</div>
	);
}
