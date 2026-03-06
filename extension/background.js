const SCRIPT_URL = "https://deloop.dev/cdn.global.js";

// Track which tabs have deloop active
const activeTabs = new Set();

chrome.action.onClicked.addListener(async (tab) => {
	if (!tab.id) return;

	if (activeTabs.has(tab.id)) {
		// Deactivate: call destroy and remove script
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				if (window.__deloop) {
					window.__deloop.destroy();
					window.__deloop = null;
				}
			},
		});
		activeTabs.delete(tab.id);
		chrome.action.setBadgeText({ text: "", tabId: tab.id });
	} else {
		// Activate: inject script from deloop.dev
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: (url) => {
				if (window.__deloop) return; // already active
				const script = document.createElement("script");
				script.src = url;
				script.onload = () => {
					window.__deloop = window.Deloop.init();
				};
				document.head.appendChild(script);
			},
			args: [SCRIPT_URL],
		});
		activeTabs.add(tab.id);
		chrome.action.setBadgeText({ text: "ON", tabId: tab.id });
		chrome.action.setBadgeBackgroundColor({
			color: "#6366f1",
			tabId: tab.id,
		});
	}
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
	activeTabs.delete(tabId);
});

// Clean up when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === "loading" && activeTabs.has(tabId)) {
		activeTabs.delete(tabId);
		chrome.action.setBadgeText({ text: "", tabId });
	}
});
