const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function SelectIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M5 3l14 6.5L12.5 12 10 19.5z" />
			<path d="M12.5 12L19 18.5" />
		</svg>
	);
}

export function DrawIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
			<path d="M14.06 6.19l3.75 3.75" />
			<path d="M20.71 7.04a1 1 0 000-1.42l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.82z" />
		</svg>
	);
}

export function TextIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M4 7V4h16v3" />
			<path d="M12 4v16" />
			<path d="M8 20h8" />
		</svg>
	);
}

export function CaptureIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<circle cx="12" cy="12" r="3" />
			<path d="M3 9h2" />
			<path d="M19 9h2" />
			<path d="M9 3v2" />
			<path d="M9 19v2" />
			<path d="M15 3v2" />
			<path d="M15 19v2" />
		</svg>
	);
}

export function AnnotationsIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M8 10h8" />
			<path d="M8 14h5" />
		</svg>
	);
}

export function SubmitIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M22 2L11 13" />
			<path d="M22 2L15 22 11 13 2 9z" />
		</svg>
	);
}

export function ElementItemIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M5 3l14 6.5L12.5 12 10 19.5z" />
		</svg>
	);
}

export function DrawItemIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
		</svg>
	);
}

export function TextItemIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M4 7V4h16v3" />
			<path d="M12 4v16" />
			<path d="M8 20h8" />
		</svg>
	);
}

export function ScreenshotItemIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

export function MarkerIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
			<circle cx="12" cy="9" r="2.5" />
		</svg>
	);
}

export function MarkerItemIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
			<circle cx="12" cy="9" r="2.5" />
		</svg>
	);
}

export function DragHandleIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
			<circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
			<circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
			<circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
			<circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
			<circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
		</svg>
	);
}

export function SunIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<circle cx="12" cy="12" r="5" />
			<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
		</svg>
	);
}

export function MoonIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
		</svg>
	);
}

export function MonitorIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="2" y="3" width="20" height="14" rx="2" />
			<path d="M8 21h8M12 17v4" />
		</svg>
	);
}

export function CopyIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="9" y="9" width="13" height="13" rx="2" />
			<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
		</svg>
	);
}

export function SaveFileIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</svg>
	);
}
