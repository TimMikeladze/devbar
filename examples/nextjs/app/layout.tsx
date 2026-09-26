import type { ReactNode } from "react";
import { DevToolbar } from "./devbar";

export const metadata = { title: "devbar Workspace example" };

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
				{children}
				<DevToolbar />
			</body>
		</html>
	);
}
