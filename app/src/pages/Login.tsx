import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { auth } from "../lib/auth";

export function LoginPage() {
	const [searchParams] = useSearchParams();
	const [mode, setMode] = useState<"signin" | "signup">(searchParams.get("signup") === "1" ? "signup" : "signin");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const navigate = useNavigate();
	const session = auth.useSession();

	useEffect(() => {
		document.title = mode === "signin" ? "Sign In – deloop.dev" : "Sign Up – deloop.dev";
	}, [mode]);

	useEffect(() => {
		if (session.data && !session.isPending) {
			navigate("/dashboard");
		}
	}, [session.data, session.isPending, navigate]);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError(null);
			setLoading(true);
			try {
				if (mode === "signin") {
					const result = await auth.signIn.email({ email, password });
					if (result.error) { setError(result.error.message ?? "Sign in failed"); return; }
				} else {
					const result = await auth.signUp.email({ email, password, name });
					if (result.error) { setError(result.error.message ?? "Sign up failed"); return; }
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

	return (
		<div className="min-h-screen bg-bg login-glow flex items-center justify-center px-5">
			<div className="w-full max-w-[380px] fade-up">
				{/* Logo */}
				<div className="text-center mb-10">
					<a href="/" className="inline-block text-[18px] font-bold tracking-tight text-fg">
						deloop<span className="text-muted">.dev</span>
					</a>
				</div>

				{/* Card */}
				<div className="bg-bg-card border border-border rounded-xl p-7 shadow-sm">
					<h1 className="text-[20px] font-semibold text-fg mb-1">
						{mode === "signin" ? "Welcome back" : "Create account"}
					</h1>
					<p className="text-[14px] text-muted mb-6">
						{mode === "signin" ? "Sign in to your dashboard" : "Get started with deloop"}
					</p>

					<form onSubmit={handleSubmit} className="space-y-4">
						{mode === "signup" && (
							<div>
								<label className="text-[13px] font-medium text-dim block mb-1.5">Name</label>
								<input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="input-field" placeholder="Your name" />
							</div>
						)}
						<div>
							<label className="text-[13px] font-medium text-dim block mb-1.5">Email</label>
							<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input-field" placeholder="you@company.com" />
						</div>
						<div>
							<label className="text-[13px] font-medium text-dim block mb-1.5">Password</label>
							<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="input-field" placeholder="Min. 8 characters" />
						</div>

						{error && (
							<div className="px-3 py-2.5 bg-rose/5 border border-rose/15 rounded-lg">
								<p className="text-[13px] text-rose">{error}</p>
							</div>
						)}

						<button type="submit" disabled={loading} className="btn-primary w-full !py-2.5">
							{loading ? (
								<span className="inline-flex items-center gap-2">
									<span className="w-3.5 h-3.5 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
									{mode === "signin" ? "Signing in..." : "Creating..."}
								</span>
							) : mode === "signin" ? "Sign In" : "Create Account"}
						</button>
					</form>
				</div>

				<p className="text-center text-[14px] text-muted mt-5">
					{mode === "signin" ? (
						<>
							Don&apos;t have an account?{" "}
							<button type="button" onClick={() => { setMode("signup"); setError(null); }} className="text-accent hover:underline cursor-pointer font-medium">Sign Up</button>
						</>
					) : (
						<>
							Already have an account?{" "}
							<button type="button" onClick={() => { setMode("signin"); setError(null); }} className="text-accent hover:underline cursor-pointer font-medium">Sign In</button>
						</>
					)}
				</p>
			</div>
		</div>
	);
}
