import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { auth } from "../lib/auth";
import { setActiveOrgId } from "../lib/api";
import { useTheme } from "../hooks/useTheme";
import { LogoMark } from "./Logo";

export function DashboardLayout() {
	const session = auth.useSession();
	const orgs = auth.useListOrganizations();
	const activeOrg = auth.useActiveOrganization();
	const navigate = useNavigate();
	const location = useLocation();
	const [showOrgDropdown, setShowOrgDropdown] = useState(false);
	const [showUserMenu, setShowUserMenu] = useState(false);

	const closeAll = useCallback(() => {
		setShowOrgDropdown(false);
		setShowUserMenu(false);
	}, []);

	useEffect(() => {
		if (session.data === null && !session.isPending) {
			navigate("/login");
		}
	}, [session.data, session.isPending, navigate]);

	const [creatingOrg, setCreatingOrg] = useState(false);

	useEffect(() => {
		if (!session.data || session.isPending || orgs.isPending || activeOrg.isPending || creatingOrg)
			return;

		if (orgs.data && orgs.data.length > 0 && !activeOrg.data) {
			auth.organization.setActive({ organizationId: orgs.data[0].id }).catch(() => {});
		} else if (orgs.data && orgs.data.length === 0) {
			setCreatingOrg(true);
			const orgName = session.data.user.name
				? `${session.data.user.name}'s Org`
				: "My Organization";
			auth.organization
				.create({ name: orgName, slug: `org-${session.data.user.id.slice(0, 8)}` })
				.then((res) => {
					if (res.data) {
						return auth.organization.setActive({ organizationId: res.data.id });
					}
				})
				.catch(() => {})
				.finally(() => setCreatingOrg(false));
		}
	}, [
		session.data,
		session.isPending,
		orgs.data,
		orgs.isPending,
		activeOrg.data,
		activeOrg.isPending,
		creatingOrg,
	]);

	useEffect(() => {
		setActiveOrgId(activeOrg.data?.id ?? null);
	}, [activeOrg.data?.id]);

	// Close dropdowns on Escape
	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeAll();
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [closeAll]);

	// Close dropdowns on route change
	useEffect(() => {
		closeAll();
	}, [location.pathname, closeAll]);

	if (session.isPending) {
		return (
			<div className="h-screen flex items-center justify-center bg-bg">
				<div className="w-5 h-5 border-2 border-border border-t-fg rounded-full animate-spin" />
			</div>
		);
	}

	if (!session.data) return null;

	const nav = [
		{ to: "/dashboard", label: "Reports" },
		{ to: "/dashboard/settings/org", label: "Organization" },
		{ to: "/dashboard/settings/billing", label: "Billing" },
		{ to: "/dashboard/settings/account", label: "Account" },
	];

	const handleSignOut = async () => {
		await auth.signOut();
		navigate("/login");
	};

	return (
		<div className="h-screen flex flex-col bg-bg text-fg overflow-hidden">
			{/* Top bar */}
			<header className="shrink-0 border-b border-border bg-bg-card relative z-50">
				<div className="max-w-5xl mx-auto px-5 h-[52px] flex items-center">
					{/* Brand */}
					<Link
						to="/"
						className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-fg shrink-0"
					>
						<LogoMark />
						deloop<span className="text-muted">.dev</span>
					</Link>
					<span className="text-border text-[18px] font-light mx-3 select-none">/</span>

					{/* Org picker */}
					<div className="relative mr-4">
						<button
							type="button"
							onClick={() => {
								setShowUserMenu(false);
								setShowOrgDropdown(!showOrgDropdown);
							}}
							aria-expanded={showOrgDropdown}
							aria-haspopup="menu"
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-hover border border-transparent hover:border-border transition-all text-left cursor-pointer"
						>
							<div className="w-5 h-5 rounded bg-fg text-bg-card flex items-center justify-center text-[10px] font-bold shrink-0">
								{activeOrg.data?.name?.charAt(0)?.toUpperCase() ?? "?"}
							</div>
							<span className="text-[14px] font-medium truncate max-w-[160px] hidden sm:block">
								{activeOrg.data?.name ?? "Select org"}
							</span>
							<ChevronDown />
						</button>
						{showOrgDropdown && (
							<Dropdown>
								{orgs.data?.map((org) => (
									<button
										key={org.id}
										type="button"
										onClick={() => {
											auth.organization.setActive({ organizationId: org.id });
											setShowOrgDropdown(false);
										}}
										className={`w-full text-left px-3 py-2 text-[14px] rounded-md hover:bg-bg-hover transition-colors cursor-pointer ${activeOrg.data?.id === org.id ? "text-accent font-medium" : "text-fg"}`}
									>
										{org.name}
									</button>
								))}
								<div className="border-t border-border mt-1 pt-1">
									<button
										type="button"
										onClick={() => {
											setShowOrgDropdown(false);
											navigate("/dashboard/settings/org?create=1");
										}}
										className="w-full text-left px-3 py-2 text-[14px] text-muted hover:text-fg hover:bg-bg-hover rounded-md transition-colors cursor-pointer"
									>
										+ New organization
									</button>
								</div>
							</Dropdown>
						)}
					</div>

					<div className="flex-1" />

					{/* User */}
					<div className="relative">
						<button
							type="button"
							onClick={() => {
								setShowOrgDropdown(false);
								setShowUserMenu(!showUserMenu);
							}}
							aria-expanded={showUserMenu}
							aria-haspopup="menu"
							className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-bg-hover transition-colors cursor-pointer"
						>
							{session.data.user.image ? (
								<img src={session.data.user.image} alt="" className="w-7 h-7 rounded-full" />
							) : (
								<div className="w-7 h-7 rounded-full bg-fg text-bg-card flex items-center justify-center text-[11px] font-bold">
									{session.data.user.name?.charAt(0)?.toUpperCase() ?? "?"}
								</div>
							)}
							<span className="text-[14px] text-fg hidden sm:block max-w-[140px] truncate">
								{session.data.user.name}
							</span>
							<ChevronDown />
						</button>
						{showUserMenu && (
							<Dropdown align="right">
								<div className="px-3 py-2.5 border-b border-border mb-1">
									<p className="text-[14px] font-medium truncate">{session.data.user.name}</p>
									<p className="text-[13px] text-muted truncate">{session.data.user.email}</p>
								</div>
								<Link
									to="/dashboard/settings/account"
									onClick={() => setShowUserMenu(false)}
									className="block w-full text-left px-3 py-2 text-[14px] text-fg hover:bg-bg-hover rounded-md transition-colors"
								>
									Account settings
								</Link>
								<div className="border-t border-border mt-1 pt-1.5 px-3 pb-1.5">
									<p className="text-[12px] text-muted mb-1.5">Theme</p>
									<ThemeToggle />
								</div>
								<div className="border-t border-border pt-1">
									<button
										type="button"
										onClick={handleSignOut}
										className="w-full text-left px-3 py-2 text-[14px] text-rose hover:bg-bg-hover rounded-md transition-colors cursor-pointer"
									>
										Sign out
									</button>
								</div>
							</Dropdown>
						)}
					</div>
				</div>

				{/* Nav tabs — scrollable row on mobile */}
				<nav className="dash-nav flex items-center gap-0.5 max-w-5xl mx-auto px-5 pb-2 -mb-px">
					{nav.map((item) => {
						const active =
							item.to === "/dashboard"
								? location.pathname === "/dashboard" ||
									location.pathname.startsWith("/dashboard/reports")
								: location.pathname.startsWith(item.to);
						return (
							<Link
								key={item.to}
								to={item.to}
								className={`px-3 py-1.5 rounded-md text-[13px] whitespace-nowrap transition-colors ${
									active
										? "font-medium text-fg dash-nav-active"
										: "text-muted hover:text-fg hover:bg-bg-hover"
								}`}
							>
								{item.label}
							</Link>
						);
					})}
				</nav>
			</header>

			{/* Main */}
			<main className="flex-1 overflow-y-auto">
				<Outlet context={{ user: session.data.user, activeOrg: activeOrg.data }} />
			</main>

			{/* Click-outside */}
			{(showOrgDropdown || showUserMenu) && (
				<div className="fixed inset-0 z-40" onClick={closeAll} />
			)}
		</div>
	);
}

function Dropdown({ children, align }: { children: React.ReactNode; align?: "right" }) {
	return (
		<div
			role="menu"
			className={`dropdown-menu absolute top-full mt-1.5 min-w-[200px] bg-bg-card border border-border rounded-lg shadow-lg shadow-black/8 z-50 p-1 ${
				align === "right" ? "right-0" : "left-0"
			}`}
		>
			{children}
		</div>
	);
}

function ChevronDown() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-muted shrink-0">
			<path
				d="M3.5 5L6 7.5L8.5 5"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const options = [
		{ value: "light" as const, label: "Light", icon: <SunIcon /> },
		{ value: "dark" as const, label: "Dark", icon: <MoonIcon /> },
		{ value: "system" as const, label: "System", icon: <MonitorIcon /> },
	];

	return (
		<div className="flex items-center bg-bg rounded-lg border border-border p-0.5 mr-3">
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					onClick={() => setTheme(opt.value)}
					title={opt.label}
					className={`relative p-1.5 rounded-md transition-all duration-150 cursor-pointer ${
						theme === opt.value
							? "bg-bg-card text-fg shadow-sm shadow-black/5"
							: "text-muted hover:text-fg"
					}`}
				>
					{opt.icon}
				</button>
			))}
		</div>
	);
}

function SunIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="8" cy="8" r="3" />
			<path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
		</svg>
	);
}

function MoonIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M13.5 8.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7z" />
		</svg>
	);
}

function MonitorIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
			<path d="M5.5 14h5M8 11.5V14" />
		</svg>
	);
}
