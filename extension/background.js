/**
 * Toggles devbar on the active tab.
 *
 * The toolbar bundle ships inside the extension (`devbar.cdn.js`, copied from
 * dist/cdn by `bun run build:extension`) rather than being fetched from a URL:
 * MV3 forbids remotely hosted code, and a page's CSP can block an injected
 * <script src>.
 *
 * Everything runs in the MAIN world. That is required, not cosmetic — React
 * fiber data lives in `__reactFiber$*` expandos on DOM nodes, which an isolated
 * world cannot see, so element capture would silently lose component context.
 */

const BUNDLE = "devbar.cdn.js";

// Tabs where devbar is currently mounted.
const activeTabs = new Set();

function setBadge(tabId, text, color) {
	chrome.action.setBadgeText({ text, tabId });
	if (text && color) chrome.action.setBadgeBackgroundColor({ color, tabId });
}

async function activate(tabId) {
	await chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		files: [BUNDLE],
	});
	const [result] = await chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		func: () => {
			if (window.__devbar) return true; // already mounted
			if (!window.Devbar) return false; // bundle failed to evaluate
			window.__devbar = window.Devbar.init();
			return true;
		},
	});
	if (!result?.result) throw new Error("devbar bundle did not define window.Devbar");
}

async function deactivate(tabId) {
	await chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		func: () => {
			window.__devbar?.destroy();
			window.__devbar = null;
		},
	});
}

chrome.action.onClicked.addListener(async (tab) => {
	const tabId = tab.id;
	if (!tabId) return;

	try {
		if (activeTabs.has(tabId)) {
			await deactivate(tabId);
			activeTabs.delete(tabId);
			setBadge(tabId, "");
		} else {
			await activate(tabId);
			activeTabs.add(tabId);
			setBadge(tabId, "ON", "#6366f1");
		}
	} catch (error) {
		// Restricted page (chrome://, the Web Store, a PDF viewer) or an
		// injection failure. Surface it instead of leaving a dead icon.
		activeTabs.delete(tabId);
		setBadge(tabId, "ERR", "#ef4444");
		console.error("devbar: could not toggle on this tab —", error);
	}
});

// A closed tab keeps no state.
chrome.tabs.onRemoved.addListener((tabId) => {
	activeTabs.delete(tabId);
});

// A navigation tears down the injected toolbar with the old document.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === "loading" && activeTabs.has(tabId)) {
		activeTabs.delete(tabId);
		setBadge(tabId, "");
	}
});
