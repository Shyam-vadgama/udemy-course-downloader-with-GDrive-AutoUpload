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
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;

    if (!clientId) {
      sendResponse({ error: "No client_id in manifest.json" });
      return;
    }

    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive");
    authUrl.searchParams.set("prompt", "select_account");

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });

    if (!responseUrl) {
      sendResponse({ error: "Auth cancelled or failed" });
      return;
    }

    const hash = responseUrl.split("#")[1];
    if (!hash) {
      sendResponse({ error: "No token in response" });
      return;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");

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
