type TextPinProps = {
	x: number;
	y: number;
	label: string;
};

export function TextPin({ x, y, label }: TextPinProps): React.ReactNode {
	return (
		<div
			data-deloop="text-pin"
			style={{
				position: "fixed",
				left: x - 8,
				top: y - 8,
				width: 16,
				height: 16,
				borderRadius: "50%",
				background: "#0070f3",
				border: "2px solid rgba(255,255,255,0.9)",
				boxShadow: "0 2px 8px rgba(0,112,243,0.4)",
				zIndex: 2147483644,
				pointerEvents: "none",
			}}
			title={label}
		/>
	);
}
