import { useState } from "react";
import type React from "react";
import { customIcon } from "./glyphs";

/**
 * Pick an emoji for a page, as Notion's icon picker does: a searchable grid of
 * the ones a product repo tends to want, any emoji pasted in, or none — back to
 * the page's coloured glyph. What it picks is written as frontmatter `icon:`.
 */

const EMOJI: [string, string][] = [
	["🚀", "rocket launch ship release"],
	["✨", "sparkles new magic feature"],
	["📐", "ruler design spec"],
	["📋", "clipboard requirements list"],
	["✅", "check done tasks complete"],
	["🗺️", "map plan roadmap"],
	["🧭", "compass guide agents rules"],
	["🧩", "puzzle skill plugin piece"],
	["🤖", "robot agent bot ai"],
	["🧠", "brain ai model think"],
	["⚡", "lightning command fast"],
	["📘", "book readme docs guide"],
	["📚", "books library docs"],
	["📄", "page doc file"],
	["📝", "memo note draft write"],
	["💡", "idea bulb light"],
	["🎯", "target goal focus"],
	["🔥", "fire hot urgent"],
	["🧪", "test lab experiment"],
	["🐛", "bug fix defect"],
	["🔒", "lock security private"],
	["🔑", "key auth login"],
	["🛡️", "shield security safety"],
	["💳", "card payment billing"],
	["🛒", "cart checkout shop"],
	["📦", "package box release"],
	["🏷️", "tag label pricing"],
	["⚙️", "gear settings config"],
	["🛠️", "tools build infra"],
	["🔍", "search find magnifier"],
	["📊", "chart analytics data"],
	["📈", "growth metrics up"],
	["🗓️", "calendar schedule date"],
	["⏱️", "timer performance speed"],
	["🌐", "globe web i18n world"],
	["📱", "phone mobile app"],
	["💻", "laptop desktop web"],
	["🎨", "palette design theme style"],
	["🖼️", "picture image media"],
	["🧱", "brick component block"],
	["🔌", "plug integration api"],
	["🗄️", "cabinet database storage"],
	["☁️", "cloud deploy hosting"],
	["🚦", "traffic light status"],
	["🚧", "construction wip progress"],
	["🧹", "broom cleanup refactor"],
	["♻️", "recycle refactor reuse"],
	["📣", "megaphone announce marketing"],
	["💬", "speech chat comments"],
	["📬", "mailbox email inbox"],
	["🔔", "bell notification alert"],
	["👤", "user profile person"],
	["👥", "users team people"],
	["🏠", "house home landing"],
	["🔗", "link url"],
	["🧾", "receipt invoice"],
	["🗂️", "dividers index folders"],
	["⭐", "star favorite"],
	["❤️", "heart love"],
	["🎉", "party celebrate launch"],
	["🏁", "flag finish done"],
	["🌱", "seedling start new"],
	["💎", "gem premium"],
	["🦄", "unicorn"],
	["🐙", "octopus github"],
	["☕", "coffee"],
	["🌙", "moon dark night"],
	["☀️", "sun light day"],
	["🟢", "green circle"],
	["🟡", "yellow circle"],
	["🔴", "red circle"],
	["🔵", "blue circle"],
	["🟣", "purple circle"],
	["⚫", "black circle"],
];

export function EmojiPicker(props: {
	current?: string;
	onPick: (emoji: string) => void;
	onRemove: () => void;
	onClose: () => void;
}): React.ReactNode {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	// A pasted or typed emoji is offered as is — any emoji, not just the grid's.
	const pasted = customIcon(query.trim());
	const shown = pasted
		? []
		: EMOJI.filter(([emoji, words]) => !q || words.includes(q) || emoji === q);

	return (
		<>
			<div className="devbar-nt-scrim" onClick={props.onClose} />
			<div className="devbar-nt-pop devbar-nt-emoji-pop" role="dialog" aria-label="Page icon">
				<div className="devbar-nt-emoji-head">
					<input
						autoFocus
						className="devbar-nt-field"
						placeholder="Filter, or paste any emoji…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.stopPropagation();
								props.onClose();
							}
							if (e.key === "Enter") {
								const pick = pasted ?? shown[0]?.[0];
								if (pick) props.onPick(pick);
							}
						}}
						aria-label="Filter emoji"
					/>
					{props.current && (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-ghost"
							onClick={props.onRemove}
						>
							Remove
						</button>
					)}
				</div>
				{pasted ? (
					<button type="button" className="devbar-nt-pop-item" onClick={() => props.onPick(pasted)}>
						<span className="devbar-nt-emoji-cell" aria-hidden="true">
							{pasted}
						</span>
						<span className="devbar-nt-pop-title">Use {pasted}</span>
					</button>
				) : shown.length ? (
					<div className="devbar-nt-emoji-grid" role="listbox" aria-label="Emoji">
						{shown.map(([emoji, words]) => (
							<button
								key={emoji}
								type="button"
								role="option"
								aria-selected={emoji === props.current}
								className={`devbar-nt-emoji-cell${emoji === props.current ? " devbar-nt-emoji-cell-on" : ""}`}
								onClick={() => props.onPick(emoji)}
								title={words.split(" ")[0]}
								aria-label={words.split(" ")[0]}
							>
								{emoji}
							</button>
						))}
					</div>
				) : (
					<p className="devbar-nt-muted devbar-nt-emoji-none">
						No match — paste any emoji to use it.
					</p>
				)}
			</div>
		</>
	);
}
