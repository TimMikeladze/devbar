const FREE_FEATURES = [
	"All annotation tools",
	"Element inspector & React context",
	"Freehand drawing & screenshots",
	"Numbered markers & comments",
	"Clipboard, JSON & Markdown export",
	"Webhook integration",
	"Custom prompt templates",
	"CDN script tag",
	"Plugin system",
];

const TEAM_FEATURES = [
	"Everything in Free",
	"Cloud dashboard",
	"Report history & search",
	"Org-level settings",
];

const ORG_FEATURES = ["Everything in Team", "Unlimited members"];

function CheckIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 14 14"
			fill="none"
			className="text-emerald shrink-0 mt-[2px]"
		>
			<path
				d="M3.5 7.5L5.5 9.5L10.5 4.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function FeatureList({ features }: { features: string[] }) {
	return (
		<ul className="space-y-2">
			{features.map((f) => (
				<li key={f} className="flex items-start gap-2.5 text-[13px] text-dim">
					<CheckIcon />
					{f}
				</li>
			))}
		</ul>
	);
}

export function PricingCards({
	onSelectTeam,
	onSelectOrg,
	actionLoading,
	teamDisabled,
	orgDisabled,
}: {
	onSelectTeam?: () => void;
	onSelectOrg?: () => void;
	actionLoading?: boolean;
	teamDisabled?: boolean;
	orgDisabled?: boolean;
}) {
	return (
		<div className="grid sm:grid-cols-3 gap-4">
			{/* Free tier */}
			<div className="pricing-card flex flex-col border border-border rounded-lg p-5 sm:p-6">
				<div className="mb-4">
					<p className="text-sm font-medium text-fg">Free</p>
					<p className="text-[13px] text-muted mt-0.5">Self-hosted, open source</p>
				</div>
				<p className="text-2xl font-bold text-fg mb-4">
					$0<span className="text-[13px] font-normal text-muted"> / forever</span>
				</p>
				<FeatureList features={FREE_FEATURES} />
			</div>

			{/* Team tier */}
			<div className="pricing-card flex flex-col border border-accent/30 rounded-lg p-5 sm:p-6 relative">
				<span className="absolute -top-2.5 left-4 px-2 py-0.5 text-[11px] font-semibold bg-accent text-white rounded-full tracking-wide">
					Popular
				</span>
				<div className="mb-4">
					<p className="text-sm font-medium text-fg">Team</p>
					<p className="text-[13px] text-muted mt-0.5">Up to 5 members</p>
				</div>
				<p className="text-2xl font-bold text-fg mb-1">
					$10<span className="text-[13px] font-normal text-muted"> / month</span>
				</p>
				<p className="text-[13px] text-muted mb-4">7-day free trial</p>
				<div className="flex-1">
					<FeatureList features={TEAM_FEATURES} />
				</div>
				{onSelectTeam && (
					<button
						type="button"
						onClick={onSelectTeam}
						disabled={actionLoading || teamDisabled}
						className="btn-primary w-full !py-2.5 text-[14px] mt-5"
					>
						{actionLoading ? "Loading..." : "Start free trial"}
					</button>
				)}
			</div>

			{/* Organization tier */}
			<div className="pricing-card flex flex-col border border-border rounded-lg p-5 sm:p-6">
				<div className="mb-4">
					<p className="text-sm font-medium text-fg">Organization</p>
					<p className="text-[13px] text-muted mt-0.5">More than 5 members</p>
				</div>
				<p className="text-2xl font-bold text-fg mb-1">
					$50<span className="text-[13px] font-normal text-muted"> / month</span>
				</p>
				<p className="text-[13px] text-muted mb-4">7-day free trial</p>
				<div className="flex-1">
					<FeatureList features={ORG_FEATURES} />
				</div>
				{onSelectOrg && (
					<button
						type="button"
						onClick={onSelectOrg}
						disabled={actionLoading || orgDisabled}
						className="btn-primary w-full !py-2.5 text-[14px] mt-5"
					>
						{actionLoading ? "Loading..." : "Start free trial"}
					</button>
				)}
			</div>
		</div>
	);
}
