import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { api } from "../lib/api";
import type { DashboardContext } from "../lib/hooks";
import { PricingCards } from "../components/PricingCards";

type ActionError = string | null;

type SubscriptionInfo = {
	plan: string;
	status: string | null;
	currentPeriodEnd: string | null;
};

const TEAM_PRICE_ID = import.meta.env.VITE_STRIPE_TEAM_PRICE_ID ?? "";
const ORG_PRICE_ID = import.meta.env.VITE_STRIPE_ORG_PRICE_ID ?? "";

export function BillingPage() {
	const { activeOrg } = useOutletContext<DashboardContext>();
	const [searchParams, setSearchParams] = useSearchParams();
	const [sub, setSub] = useState<SubscriptionInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState(false);
	const [actionError, setActionError] = useState<ActionError>(null);

	const success = searchParams.get("success") === "1";
	const canceled = searchParams.get("canceled") === "1";

	useEffect(() => {
		document.title = "Billing – devbar.sh";
	}, []);

	// Clear success/canceled from URL after showing
	useEffect(() => {
		if (success || canceled) {
			const timeout = setTimeout(() => {
				setSearchParams({}, { replace: true });
			}, 5000);
			return () => clearTimeout(timeout);
		}
	}, [success, canceled, setSearchParams]);

	const refresh = useCallback(() => {
		if (!activeOrg) {
			setLoading(false);
			return;
		}
		setLoading(true);
		api<SubscriptionInfo>("/stripe/subscription")
			.then(setSub)
			.catch(() => setSub({ plan: "free", status: null, currentPeriodEnd: null }))
			.finally(() => setLoading(false));
	}, [activeOrg]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleCheckout = useCallback(async (priceId: string) => {
		setActionError(null);
		setActionLoading(true);
		try {
			const { url } = await api<{ url: string }>("/stripe/checkout", {
				method: "POST",
				body: JSON.stringify({ priceId }),
			});
			if (url) window.location.href = url;
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to start checkout");
		} finally {
			setActionLoading(false);
		}
	}, []);

	const handlePortal = useCallback(async () => {
		setActionError(null);
		setActionLoading(true);
		try {
			const { url } = await api<{ url: string }>("/stripe/portal", {
				method: "POST",
			});
			if (url) window.location.href = url;
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to open billing portal");
		} finally {
			setActionLoading(false);
		}
	}, []);

	if (!activeOrg) {
		return (
			<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
				{success && (
					<div className="px-4 py-3 bg-emerald/5 border border-emerald/15 rounded-lg mb-6">
						<p className="text-[14px] text-emerald">Subscription activated. Welcome to the team!</p>
					</div>
				)}
				{canceled && (
					<div className="px-4 py-3 bg-amber/5 border border-amber/15 rounded-lg mb-6">
						<p className="text-[14px] text-amber">Checkout was canceled. No charges were made.</p>
					</div>
				)}
				<p className="text-[15px] text-muted">Select an organization to manage billing.</p>
			</div>
		);
	}

	const isPaid = sub?.plan === "team" || sub?.plan === "org";
	const isActive = sub?.status === "active" || sub?.status === "trialing";
	const needsAttention = sub?.status === "past_due" || sub?.status === "unpaid";

	return (
		<div className="p-8 sm:p-10 max-w-5xl mx-auto fade-up">
			<h1 className="text-[24px] font-semibold tracking-tight mb-1">Billing</h1>
			<p className="text-[15px] text-muted mb-8">Manage your subscription for {activeOrg.name}</p>

			{success && (
				<div className="px-4 py-3 bg-emerald/5 border border-emerald/15 rounded-lg mb-6">
					<p className="text-[14px] text-emerald">Subscription activated. Welcome to the team!</p>
				</div>
			)}
			{canceled && (
				<div className="px-4 py-3 bg-amber/5 border border-amber/15 rounded-lg mb-6">
					<p className="text-[14px] text-amber">Checkout was canceled. No charges were made.</p>
				</div>
			)}
			{actionError && (
				<div className="px-4 py-3 bg-rose/5 border border-rose/15 rounded-lg mb-6">
					<p className="text-[14px] text-rose">{actionError}</p>
				</div>
			)}

			{/* Current plan */}
			<div className="bg-bg-card border border-border rounded-xl p-6 mb-6">
				<div className="flex items-center justify-between mb-4">
					<div>
						<p className="text-[13px] text-muted mb-0.5">Current plan</p>
						{loading ? (
							<div className="skeleton w-20 h-6" />
						) : (
							<p className="text-[20px] font-semibold capitalize">{sub?.plan ?? "Free"}</p>
						)}
					</div>
					{!loading && isPaid && isActive && sub?.currentPeriodEnd && (
						<div className="text-right">
							<p className="text-[13px] text-muted">
								{sub.status === "trialing" ? "Trial ends" : "Renews"}{" "}
								{new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
									year: "numeric",
								})}
							</p>
						</div>
					)}
				</div>
				{!loading && isPaid && (isActive || needsAttention) && (
					<>
						{needsAttention && (
							<div className="px-3 py-2.5 bg-rose/5 border border-rose/15 rounded-lg mb-3">
								<p className="text-[13px] text-rose">
									Payment issue — please update your payment method.
								</p>
							</div>
						)}
						<button
							type="button"
							onClick={handlePortal}
							disabled={actionLoading}
							className="btn-secondary text-[14px]"
						>
							{actionLoading ? "Loading..." : "Manage Subscription"}
						</button>
					</>
				)}
			</div>

			{/* Plans */}
			{!loading && (!isPaid || (!isActive && !needsAttention)) && (
				<div>
					<h2 className="text-[15px] font-semibold mb-3">Choose a plan</h2>
					<PricingCards
						onSelectTeam={() => handleCheckout(TEAM_PRICE_ID)}
						onSelectOrg={() => handleCheckout(ORG_PRICE_ID)}
						actionLoading={actionLoading}
						teamDisabled={!TEAM_PRICE_ID}
						orgDisabled={!ORG_PRICE_ID}
						hideFree
						actionLabel={isPaid ? "Subscribe" : "Start free trial"}
					/>
				</div>
			)}

			{/* Already subscribed - show manage option */}
			{!loading && isPaid && isActive && (
				<p className="text-[13px] text-muted mt-2">
					Use "Manage Subscription" to upgrade, downgrade, update payment method, or cancel.
				</p>
			)}
		</div>
	);
}
