console.log("Udemy Snap background service worker loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "clearToken") {
    chrome.identity.removeCachedAuthToken(
      { token: message.token },
      () => {
        console.log("Drive token cleared from cache");
      }
    );
  }
});
