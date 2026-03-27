const S = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
};

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

export function RecordIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
		</svg>
	);
}

export function RecordItemIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<circle cx="12" cy="12" r="9" />
			<polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
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

export function ChevronRightIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M9 18l6-6-6-6" />
		</svg>
	);
}

export function ChevronDownIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M6 9l6 6 6-6" />
		</svg>
	);
}

export function ChevronUpIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M18 15l-6-6-6 6" />
		</svg>
	);
}

export function ToolbarModeIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="4" y="16" width="16" height="4" rx="2" />
			<path d="M8 12h8" />
			<path d="M6 8h12" />
		</svg>
	);
}

export function PreviewIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
			<polyline points="14 2 14 8 20 8" />
			<line x1="16" y1="13" x2="8" y2="13" />
			<line x1="16" y1="17" x2="8" y2="17" />
			<polyline points="10 9 9 9 8 9" />
		</svg>
	);
}

export function SettingsIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
		</svg>
	);
}

export function UserIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</svg>
	);
}

export function LogOutIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
			<polyline points="16 17 21 12 16 7" />
			<line x1="21" y1="12" x2="9" y2="12" />
		</svg>
	);
}

export function SendIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</svg>
	);
}

export function HistoryIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
			<path d="M3 3v5h5" />
			<path d="M12 7v5l4 2" />
		</svg>
	);
}

export function LabelIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
			<circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}
