const SCRIPT_URL = "https://devbar.sh/cdn.global.js";

// Track which tabs have devbar active
const activeTabs = new Set();

chrome.action.onClicked.addListener(async (tab) => {
	if (!tab.id) return;

	if (activeTabs.has(tab.id)) {
		// Deactivate: call destroy and remove script
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				if (window.__devbar) {
					window.__devbar.destroy();
					window.__devbar = null;
				}
			},
		});
		activeTabs.delete(tab.id);
		chrome.action.setBadgeText({ text: "", tabId: tab.id });
	} else {
		// Activate: inject script from devbar.sh
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: (url) => {
				if (window.__devbar) return; // already active
				const script = document.createElement("script");
				script.src = url;
				script.onload = () => {
					window.__devbar = window.Devbar.init();
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
