import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { auth } from "../lib/auth";
import { PasswordInput } from "../components/PasswordInput";
import { LogoMark } from "../components/Logo";

export function LoginPage() {
	const [searchParams] = useSearchParams();
	const initialMode =
		searchParams.get("signup") === "1"
			? "signup"
			: searchParams.get("reset") === "1"
				? "forgot"
				: "signin";
	const [mode, setMode] = useState<"signin" | "signup" | "forgot">(initialMode);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState<string | null>(null);
	const navigate = useNavigate();
	const session = auth.useSession();

	useEffect(() => {
		const titles = {
			signin: "Sign In – deloop.dev",
			signup: "Sign Up – deloop.dev",
			forgot: "Reset Password – deloop.dev",
		};
		document.title = titles[mode];
	}, [mode]);

	useEffect(() => {
		if (session.data && !session.isPending) {
			navigate("/dashboard");
		}
	}, [session.data, session.isPending, navigate]);

	const switchMode = useCallback((next: "signin" | "signup" | "forgot") => {
		setMode(next);
		setError(null);
		setSuccess(null);
	}, []);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError(null);
			setSuccess(null);
			setLoading(true);
			try {
				if (mode === "forgot") {
					const result = await auth.requestPasswordReset({
						email,
						redirectTo: `${window.location.origin}/login?reset=1`,
					});
					if (result.error) {
						setError(result.error.message ?? "Failed to send reset email");
						return;
					}
					setSuccess("If an account exists with that email, you'll receive a password reset link.");
					return;
				}
				if (mode === "signin") {
					const result = await auth.signIn.email({ email, password });
					if (result.error) {
						setError(result.error.message ?? "Sign in failed");
						return;
					}
				} else {
					const result = await auth.signUp.email({ email, password, name });
					if (result.error) {
						setError(result.error.message ?? "Sign up failed");
						return;
					}
					setSuccess("Account created! Check your email to verify your address.");
					return;
				}
				navigate("/dashboard");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setLoading(false);
			}
		},
		[mode, email, password, name, navigate],
	);

	const headings = {
		signin: { title: "Welcome back", sub: "Sign in to your dashboard" },
		signup: { title: "Create account", sub: "Get started with deloop" },
		forgot: { title: "Reset password", sub: "Enter your email to receive a reset link" },
	};

	if (session.isPending) {
		return (
			<div className="min-h-screen bg-bg flex items-center justify-center">
				<div className="w-5 h-5 border-2 border-border border-t-fg rounded-full animate-spin" />
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-bg login-glow flex items-center justify-center px-5">
			<div className="w-full max-w-[380px] fade-up">
				{/* Logo */}
				<div className="text-center mb-10">
					<a
						href="/"
						className="inline-flex items-center gap-2 text-[18px] font-bold tracking-tight text-fg"
					>
						<LogoMark />
						deloop<span className="text-muted">.dev</span>
					</a>
				</div>

				{/* Card */}
				<div className="bg-bg-card border border-border rounded-xl p-7 shadow-sm">
					<h1 className="text-[20px] font-semibold text-fg mb-1">{headings[mode].title}</h1>
					<p className="text-[14px] text-muted mb-6">{headings[mode].sub}</p>

					<form onSubmit={handleSubmit} className="space-y-4">
						{mode === "signup" && (
							<div>
								<label
									htmlFor="login-name"
									className="text-[13px] font-medium text-dim block mb-1.5"
								>
									Name
								</label>
								<input
									id="login-name"
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									required
									autoComplete="name"
									className="input-field"
									placeholder="Your name"
								/>
							</div>
						)}
						<div>
							<label
								htmlFor="login-email"
								className="text-[13px] font-medium text-dim block mb-1.5"
							>
								Email
							</label>
							<input
								id="login-email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
								className="input-field"
								placeholder="you@company.com"
							/>
						</div>
						{mode !== "forgot" && (
							<div>
								<div className="flex items-center justify-between mb-1.5">
									<label htmlFor="login-password" className="text-[13px] font-medium text-dim">
										Password
									</label>
									{mode === "signin" && (
										<button
											type="button"
											onClick={() => switchMode("forgot")}
											className="text-[12px] text-accent hover:underline cursor-pointer"
										>
											Forgot password?
										</button>
									)}
								</div>
								<PasswordInput
									id="login-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									minLength={8}
									autoComplete={mode === "signin" ? "current-password" : "new-password"}
									placeholder="Min. 8 characters"
								/>
							</div>
						)}

						{error && (
							<div className="px-3 py-2.5 bg-rose/5 border border-rose/15 rounded-lg">
								<p className="text-[13px] text-rose">{error}</p>
							</div>
						)}

						{success && (
							<div className="px-3 py-2.5 bg-emerald/5 border border-emerald/15 rounded-lg">
								<p className="text-[13px] text-emerald">{success}</p>
							</div>
						)}

						<button type="submit" disabled={loading} className="btn-primary w-full !py-2.5">
							{loading ? (
								<span className="inline-flex items-center gap-2">
									<span className="w-3.5 h-3.5 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
									{mode === "signin"
										? "Signing in..."
										: mode === "signup"
											? "Creating..."
											: "Sending..."}
								</span>
							) : mode === "signin" ? (
								"Sign In"
							) : mode === "signup" ? (
								"Create Account"
							) : (
								"Send Reset Link"
							)}
						</button>
					</form>
				</div>

				<p className="text-center text-[14px] text-muted mt-5">
					{mode === "signin" ? (
						<>
							Don&apos;t have an account?{" "}
							<button
								type="button"
								onClick={() => switchMode("signup")}
								className="text-accent hover:underline cursor-pointer font-medium"
							>
								Sign Up
							</button>
						</>
					) : (
						<>
							Already have an account?{" "}
							<button
								type="button"
								onClick={() => switchMode("signin")}
								className="text-accent hover:underline cursor-pointer font-medium"
							>
								Sign In
							</button>
						</>
					)}
				</p>
			</div>
		</div>
	);
}
