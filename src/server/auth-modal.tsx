import { useCallback, useState } from "react";
import type { DeloopAuthClient } from "./client";

type AuthModalProps = {
	client: DeloopAuthClient;
	onSuccess: () => void;
	onClose: () => void;
};

export function AuthModal({ client, onSuccess, onClose }: AuthModalProps): React.ReactNode {
	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError(null);
			setLoading(true);

			try {
				if (mode === "signin") {
					const result = await client.signIn.email({ email, password });
					if (result.error) {
						setError(result.error.message ?? "Sign in failed");
						return;
					}
				} else {
					const result = await client.signUp.email({ email, password, name });
					if (result.error) {
						setError(result.error.message ?? "Sign up failed");
						return;
					}
				}
				onSuccess();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setLoading(false);
			}
		},
		[client, mode, email, password, name, onSuccess],
	);

	return (
		<div className="deloop-auth-backdrop" onClick={onClose}>
			<div className="deloop-auth-modal" onClick={(e) => e.stopPropagation()}>
				<div className="deloop-auth-header">
					<span className="deloop-panel-title">{mode === "signin" ? "Sign In" : "Sign Up"}</span>
					<button type="button" className="deloop-panel-close" onClick={onClose}>
						&times;
					</button>
				</div>
				<form className="deloop-auth-form" onSubmit={handleSubmit}>
					{mode === "signup" && (
						<input
							className="deloop-auth-input"
							type="text"
							placeholder="Name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					)}
					<input
						className="deloop-auth-input"
						type="email"
						placeholder="Email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
					<input
						className="deloop-auth-input"
						type="password"
						placeholder="Password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
					/>
					{error && <div className="deloop-auth-error">{error}</div>}
					<button type="submit" className="deloop-auth-submit" disabled={loading}>
						{loading ? "..." : mode === "signin" ? "Sign In" : "Sign Up"}
					</button>
				</form>
				<div className="deloop-auth-switch">
					{mode === "signin" ? (
						<>
							Don&apos;t have an account?{" "}
							<button type="button" className="deloop-auth-link" onClick={() => { setMode("signup"); setError(null); }}>
								Sign Up
							</button>
						</>
					) : (
						<>
							Already have an account?{" "}
							<button type="button" className="deloop-auth-link" onClick={() => { setMode("signin"); setError(null); }}>
								Sign In
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
