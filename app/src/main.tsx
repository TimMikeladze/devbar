import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import App from "./App.tsx";
import { DashboardLayout } from "./components/Layout.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { ReportsPage } from "./pages/Reports.tsx";
import { ReportDetailPage } from "./pages/ReportDetail.tsx";
import { OrgSettingsPage } from "./pages/OrgSettings.tsx";
import { AccountSettingsPage } from "./pages/AccountSettings.tsx";
import { BillingPage } from "./pages/Billing.tsx";
import { Link } from "react-router";

function NotFound() {
	return (
		<div className="h-screen flex items-center justify-center bg-bg text-fg login-glow">
			<div className="text-center fade-up">
				<p className="text-[96px] sm:text-[120px] font-bold tracking-[-0.05em] leading-none text-border select-none">404</p>
				<p className="text-[18px] font-semibold mt-4">Nothing here</p>
				<p className="text-[14px] text-muted mt-1.5 mb-6">The page you're looking for doesn't exist or was moved.</p>
				<Link to="/" className="btn-primary inline-flex !px-5 !py-2.5 text-[14px]">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mr-1.5">
						<path d="M8.5 3.5L5 7l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
					Back to home
				</Link>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<Routes>
				{/* Public landing page */}
				<Route index element={<App />} />
				{/* Auth */}
				<Route path="/login" element={<LoginPage />} />
				{/* Dashboard (protected) */}
				<Route path="/dashboard" element={<DashboardLayout />}>
					<Route index element={<ReportsPage />} />
					<Route path="reports/:id" element={<ReportDetailPage />} />
					<Route path="settings/org" element={<OrgSettingsPage />} />
					<Route path="settings/account" element={<AccountSettingsPage />} />
					<Route path="settings/billing" element={<BillingPage />} />
				</Route>
				{/* 404 */}
				<Route path="*" element={<NotFound />} />
			</Routes>
		</BrowserRouter>
	</StrictMode>,
);
