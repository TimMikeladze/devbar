import { useState } from "react";

function EyeIcon({ open }: { open: boolean }) {
	if (open) {
		return (
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
				<circle cx="8" cy="8" r="2" />
			</svg>
		);
	}
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M6.59 6.59a2 2 0 0 0 2.82 2.82" />
			<path d="M4.18 4.18A6.5 6.5 0 0 0 1.5 8s2.5 4.5 6.5 4.5a6.1 6.1 0 0 0 3.32-1.01" />
			<path d="M10.73 5.08A6.4 6.4 0 0 1 14.5 8s-2.5 4.5-6.5 4.5" />
			<path d="M14.5 8a6.5 6.5 0 0 0-1.18-1.82" />
			<line x1="2" y1="2" x2="14" y2="14" />
		</svg>
	);
}

export function PasswordInput({
	id,
	value,
	onChange,
	placeholder,
	autoComplete,
	required,
	minLength,
}: {
	id?: string;
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	placeholder: string;
	autoComplete: string;
	required?: boolean;
	minLength?: number;
}) {
	const [show, setShow] = useState(false);
	return (
		<div className="relative">
			<input
				id={id}
				type={show ? "text" : "password"}
				value={value}
				onChange={onChange}
				required={required}
				minLength={minLength}
				autoComplete={autoComplete}
				className="input-field w-full pr-10"
				placeholder={placeholder}
			/>
			<button
				type="button"
				onClick={() => setShow(!show)}
				tabIndex={-1}
				className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors cursor-pointer"
			>
				<EyeIcon open={show} />
			</button>
		</div>
	);
}
