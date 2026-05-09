console.log("Udemy Snap background service worker loaded");

const STORAGE_TOKEN_KEY = "driveToken";
const STORAGE_ACCOUNT_KEY = "driveAccount";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "clearToken") {
    chrome.identity.removeCachedAuthToken({ token: message.token }, () => {
      console.log("Drive token cleared");
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "getDriveToken") {
    handleGoogleAuth(sendResponse);
    return true;
  }

  if (message.type === "getStoredToken") {
    chrome.storage.local.get(
      [STORAGE_TOKEN_KEY, STORAGE_ACCOUNT_KEY],
      (data) => {
        sendResponse({
          token: data[STORAGE_TOKEN_KEY] || null,
          account: data[STORAGE_ACCOUNT_KEY] || null,
        });
      }
    );
    return true;
  }
});

async function handleGoogleAuth(sendResponse) {
  try {
    try {
      const cached = await chrome.identity.getAuthToken({ interactive: false });
      const token = cached?.token || cached?.accessToken || cached;
      if (token) {
        await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
      }
    } catch {}
    const tokenResult = await chrome.identity.getAuthToken({ interactive: true });
    const accessToken = tokenResult?.token || tokenResult?.accessToken || tokenResult;

    if (!accessToken) {
      sendResponse({ error: "No access token received" });
      return;
    }

    chrome.storage.local.set({ [STORAGE_TOKEN_KEY]: accessToken }, () => {
      sendResponse({ token: accessToken });
    });
  } catch (e) {
    console.error("Auth error:", e);
    sendResponse({ error: e.message || "Auth failed" });
  }
}
