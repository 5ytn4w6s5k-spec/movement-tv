// Clicking the toolbar button opens the app in a new tab.
chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: 'https://www.skool.com/__tvapp/index.html' });
});
