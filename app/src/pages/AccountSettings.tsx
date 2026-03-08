import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { auth } from "../lib/auth";
import type { DashboardContext } from "../lib/hooks";

export function AccountSettingsPage() {
	const { user } = useOutletContext<DashboardContext>();
	const navigate = useNavigate();

	useEffect(() => {
		document.title = "Account – deloop.dev";
	}, []);

	const handleSignOut = useCallback(async () => {
		await auth.signOut();
		navigate("/login");
	}, [navigate]);

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			<h1 className="text-[24px] font-semibold tracking-tight mb-1">Account</h1>
			<p className="text-[15px] text-muted mb-8">Manage your profile</p>

			{/* Profile */}
			<div className="bg-bg-card border border-border rounded-xl p-6 mb-8">
				<div className="flex items-center gap-4">
					{user.image ? (
						<img src={user.image} alt="" className="w-14 h-14 rounded-full" />
					) : (
						<div className="w-14 h-14 rounded-full bg-fg text-bg-card flex items-center justify-center text-xl font-bold">
							{user.name?.charAt(0)?.toUpperCase() ?? "?"}
						</div>
					)}
					<div>
						<p className="text-[16px] font-semibold">{user.name}</p>
						<p className="text-[14px] text-muted mt-0.5">{user.email}</p>
					</div>
				</div>
			</div>

			<ChangePassword />

			<div className="mt-10 pt-6 border-t border-border">
				<button
					type="button"
					onClick={handleSignOut}
					className="btn-secondary text-rose border-border hover:border-rose/30 hover:bg-rose/5 !text-[14px]"
				>
					Sign Out
				</button>
			</div>
		</div>
	);
}

function ChangePassword() {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setLoading(true);
			setMessage(null);
			try {
				const result = await auth.changePassword({ currentPassword, newPassword });
				if (result.error) {
					setMessage({ type: "error", text: result.error.message ?? "Failed to change password" });
					return;
				}
				setMessage({ type: "success", text: "Password changed successfully" });
				setCurrentPassword("");
				setNewPassword("");
			} catch (err) {
				setMessage({
					type: "error",
					text: err instanceof Error ? err.message : "Something went wrong",
				});
			} finally {
				setLoading(false);
			}
		},
		[currentPassword, newPassword],
	);

	return (
		<div>
			<h2 className="text-[15px] font-semibold mb-4">Change Password</h2>
			<div className="bg-bg-card border border-border rounded-xl p-6">
				<form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
					<div>
						<label className="text-[13px] font-medium text-dim block mb-1.5">
							Current password
						</label>
						<input
							type="password"
							value={currentPassword}
							onChange={(e) => setCurrentPassword(e.target.value)}
							required
							className="input-field"
							placeholder="Enter current password"
						/>
					</div>
					<div>
						<label className="text-[13px] font-medium text-dim block mb-1.5">New password</label>
						<input
							type="password"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							required
							minLength={8}
							className="input-field"
							placeholder="Min. 8 characters"
						/>
					</div>
					{message && (
						<div
							className={`px-3 py-2.5 rounded-lg border ${message.type === "error" ? "bg-rose/5 border-rose/15" : "bg-emerald/5 border-emerald/15"}`}
						>
							<p
								className={`text-[13px] ${message.type === "error" ? "text-rose" : "text-emerald"}`}
							>
								{message.text}
							</p>
						</div>
					)}
					<button type="submit" disabled={loading} className="btn-primary !px-5">
						{loading ? "Updating..." : "Update Password"}
					</button>
				</form>
			</div>
		</div>
	);
}
