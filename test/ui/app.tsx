import "./styles.css";

import { DeloopToolbar } from "../../src";

export function App() {
	return (
		<main>
			<header style={{ marginBottom: 32 }}>
				<h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Deloop Test Page</h1>
				<p style={{ color: "#6b7280", fontSize: 15 }}>
					Use the toolbar in the bottom-right to annotate elements, draw, add text notes, and capture screenshots.
				</p>
			</header>

			<section style={{ marginBottom: 32 }}>
				<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Form Elements</h2>
				<div style={{ padding: 20, background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: 12 }}>
					<div>
						<label htmlFor="name" style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Name</label>
						<input id="name" type="text" placeholder="Enter your name" style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, width: "100%" }} />
					</div>
					<div>
						<label htmlFor="email" style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Email</label>
						<input id="email" type="email" placeholder="you@example.com" style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, width: "100%" }} />
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<button type="button" style={{ padding: "8px 20px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>Submit</button>
						<button type="button" style={{ padding: "8px 20px", background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>Cancel</button>
					</div>
				</div>
			</section>

			<section style={{ marginBottom: 32 }}>
				<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Card Layout</h2>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
					<div style={{ padding: 20, background: "#dbeafe", borderRadius: 8, textAlign: "center" }}>
						<div style={{ fontSize: 24, marginBottom: 8 }}>A</div>
						<div style={{ fontSize: 13, color: "#1e40af" }}>Feature Card</div>
					</div>
					<div style={{ padding: 20, background: "#fef3c7", borderRadius: 8, textAlign: "center" }}>
						<div style={{ fontSize: 24, marginBottom: 8 }}>B</div>
						<div style={{ fontSize: 13, color: "#92400e" }}>Pricing Card</div>
					</div>
					<div style={{ padding: 20, background: "#dcfce7", borderRadius: 8, textAlign: "center" }}>
						<div style={{ fontSize: 24, marginBottom: 8 }}>C</div>
						<div style={{ fontSize: 13, color: "#166534" }}>Status Card</div>
					</div>
				</div>
			</section>

			<section style={{ marginBottom: 32 }}>
				<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Table</h2>
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
					<thead>
						<tr style={{ borderBottom: "2px solid #e5e7eb" }}>
							<th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Name</th>
							<th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Role</th>
							<th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Status</th>
						</tr>
					</thead>
					<tbody>
						<tr style={{ borderBottom: "1px solid #f3f4f6" }}>
							<td style={{ padding: "8px 12px" }}>Alice</td>
							<td style={{ padding: "8px 12px" }}>Engineer</td>
							<td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", background: "#dcfce7", color: "#166534", borderRadius: 12, fontSize: 12 }}>Active</span></td>
						</tr>
						<tr style={{ borderBottom: "1px solid #f3f4f6" }}>
							<td style={{ padding: "8px 12px" }}>Bob</td>
							<td style={{ padding: "8px 12px" }}>Designer</td>
							<td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", background: "#fef3c7", color: "#92400e", borderRadius: 12, fontSize: 12 }}>Away</span></td>
						</tr>
						<tr>
							<td style={{ padding: "8px 12px" }}>Charlie</td>
							<td style={{ padding: "8px 12px" }}>PM</td>
							<td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", background: "#fee2e2", color: "#991b1b", borderRadius: 12, fontSize: 12 }}>Offline</span></td>
						</tr>
					</tbody>
				</table>
			</section>

			<section>
				<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Broken Elements (for testing)</h2>
				<div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
					<button type="button" style={{ padding: "8px 16px", background: "#3b82f6", color: "#3b82f6", border: "none", borderRadius: 6, cursor: "pointer" }}>
						Invisible Text Bug
					</button>
					<div style={{ width: 150, height: 60, background: "#ef4444", borderRadius: 8, position: "relative" }}>
						<div style={{ position: "absolute", top: -10, left: -10, width: 170, height: 80, background: "rgba(0,0,0,0.1)", borderRadius: 4 }}>
							Overflow Bug
						</div>
					</div>
					<div style={{ width: 100, height: 40, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #d1d5db", borderRadius: 6, fontSize: 11 }}>
						Misaligned
					</div>
				</div>
			</section>

			<DeloopToolbar
				clipboard
				onSubmit={(payload) => console.log("Deloop payload:", payload)}
			/>
		</main>
	);
}

export default App;
