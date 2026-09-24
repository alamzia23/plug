// plug — service worker.
// Day 1 does one thing: make the toolbar icon open the side panel.
// Capture itself runs from the panel, so there is no message plumbing here yet.

function openPanelOnClick() {
  // Not supported before Chrome 116; fail quiet and the action falls back to nothing.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("[plug] setPanelBehavior failed:", err));
}

chrome.runtime.onInstalled.addListener(openPanelOnClick);
chrome.runtime.onStartup.addListener(openPanelOnClick);
