/** Selection-box brand mark — a bracketed element with four corner handles. */
export function LogoMark() {
	return (
		<span className="dl-logo" aria-hidden="true">
			<span className="dl-logo-tick dl-logo-tl" />
			<span className="dl-logo-tick dl-logo-tr" />
			<span className="dl-logo-tick dl-logo-bl" />
			<span className="dl-logo-tick dl-logo-br" />
		</span>
	);
}
