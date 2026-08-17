export type ReactComponentInfo = {
	name: string;
	props: Record<string, unknown>;
	source: {
		fileName: string;
		lineNumber: number;
		columnNumber: number;
	} | null;
};

export type ReactComponentContext = {
	componentPath: string;
	components: ReactComponentInfo[];
};

type Fiber = {
	tag: number;
	type: unknown;
	memoizedProps: Record<string, unknown> | null;
	return: Fiber | null;
	_debugSource?: {
		fileName: string;
		lineNumber: number;
		columnNumber: number;
	};
};

// React fiber tags for function/class components
const FUNCTION_COMPONENT = 0;
const CLASS_COMPONENT = 1;
const FORWARD_REF = 11;
const MEMO_COMPONENT = 14;
const SIMPLE_MEMO_COMPONENT = 15;

const COMPONENT_TAGS = new Set([
	FUNCTION_COMPONENT,
	CLASS_COMPONENT,
	FORWARD_REF,
	MEMO_COMPONENT,
	SIMPLE_MEMO_COMPONENT,
]);

const MAX_DEPTH = 30;

function getFiberFromElement(el: Element): Fiber | null {
	const keys = Object.keys(el);
	for (const key of keys) {
		if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
			return (el as unknown as Record<string, Fiber>)[key] ?? null;
		}
	}
	return null;
}

function getComponentName(fiber: Fiber): string {
	const type = fiber.type;
	if (!type) return "Anonymous";

	if (typeof type === "string") return type;

	if (typeof type === "function") {
		const fn = type as { displayName?: string; name?: string };
		return fn.displayName ?? fn.name ?? "Anonymous";
	}

	// ForwardRef: { render: fn, displayName? }
	if (typeof type === "object" && type !== null) {
		const obj = type as Record<string, unknown>;
		if (typeof obj.displayName === "string") return obj.displayName;
		if (typeof obj.render === "function") {
			const render = obj.render as { displayName?: string; name?: string };
			return render.displayName ?? render.name ?? "ForwardRef";
		}
		// Memo: { type: fn }
		if (typeof obj.type === "function") {
			const inner = obj.type as { displayName?: string; name?: string };
			return inner.displayName ?? inner.name ?? "Memo";
		}
	}

	return "Anonymous";
}

function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(props)) {
		if (key === "children") continue;
		if (typeof value === "function") {
			result[key] = "[Function]";
		} else if (typeof value === "symbol") {
			result[key] = value.toString();
		} else if (value instanceof Element) {
			result[key] = "[Element]";
		} else if (typeof value === "object" && value !== null) {
			try {
				const json = JSON.stringify(value);
				result[key] = json.length > 500 ? `${json.slice(0, 500)}...` : JSON.parse(json);
			} catch {
				result[key] = "[Object]";
			}
		} else {
			result[key] = value;
		}
	}
	return result;
}

export function extractReactContext(
	el: Element,
	includeProps = true,
): ReactComponentContext | null {
	const fiber = getFiberFromElement(el);
	if (!fiber) return null;

	const components: ReactComponentInfo[] = [];
	let current: Fiber | null = fiber;
	let depth = 0;

	while (current && depth < MAX_DEPTH) {
		if (COMPONENT_TAGS.has(current.tag)) {
			const name = getComponentName(current);
			components.unshift({
				name,
				props: includeProps && current.memoizedProps ? serializeProps(current.memoizedProps) : {},
				source: current._debugSource
					? {
							fileName: current._debugSource.fileName,
							lineNumber: current._debugSource.lineNumber,
							columnNumber: current._debugSource.columnNumber,
						}
					: null,
			});
		}
		current = current.return;
		depth++;
	}

	if (components.length === 0) return null;

	return {
		componentPath: components.map((c) => c.name).join(" > "),
		components,
	};
}
