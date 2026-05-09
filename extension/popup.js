const DEFAULT_BACKEND = "";
let driveToken = null;

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupButtons();
  detectCurrentCourse();
  loadSettings();
});

function loadSettings() {
  chrome.storage.local.get(
    ["backendUrl", "driveToken", "driveAccount", "jobId"],
    async (data) => {
      if (data.backendUrl) {
        document.getElementById("backend-url").value = data.backendUrl;
      }
      if (data.driveToken) {
        driveToken = data.driveToken;
        const valid = await testDriveToken(driveToken);
        if (valid) {
          updateDriveUI(true, data.driveAccount || "Google Drive connected");
        } else {
          driveToken = null;
          chrome.storage.local.remove("driveToken");
          updateDriveUI(false);
        }
      }
      if (data.jobId) {
        showJobStatus(data.jobId);
      }
    }
  );
}

function saveSettings(key, value) {
  chrome.storage.local.set({ [key]: value });
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
      tab.classList.add("active");
      document.getElementById(`${tab.dataset.tab}-tab`).classList.remove("hidden");
    });
  });
}

function setupButtons() {
  document.getElementById("start-btn").addEventListener("click", startDownload);
  document.getElementById("next-btn").addEventListener("click", processNext);
  document.getElementById("refresh-btn").addEventListener("click", refreshStatus);
  document.getElementById("continue-btn").addEventListener("click", processNext);
  document.getElementById("connect-drive-btn").addEventListener("click", connectDrive);

  document.getElementById("backend-url").addEventListener("input", (e) => {
    saveSettings("backendUrl", e.target.value);
  });
}

function updateDriveUI(connected, account = null) {
  const btn = document.getElementById("connect-drive-btn");
  const status = document.getElementById("drive-status");
  const info = document.getElementById("drive-info");
  const accountEl = document.getElementById("drive-account");

  if (connected) {
    btn.textContent = "Disconnect Google Drive";
    btn.classList.add("secondary");
    status.textContent = "Connected";
    status.className = "status success";
    info.classList.remove("hidden");
    accountEl.textContent = account || "Google Drive connected";
  } else {
    btn.textContent = "Connect Google Drive";
    btn.classList.remove("secondary");
    status.textContent = "Not connected";
    status.className = "status";
    info.classList.add("hidden");
  }
}

async function connectDrive() {
  const btn = document.getElementById("connect-drive-btn");

  if (driveToken) {
    try {
      await chrome.identity.removeCachedAuthToken({ token: driveToken });
    } catch (e) {
      console.log("Clear token error:", e);
    }
    driveToken = null;
    chrome.storage.local.remove(["driveToken", "driveAccount"]);
    updateDriveUI(false);
    document.getElementById("drive-status").textContent = "Disconnected";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in...";
  document.getElementById("drive-status").textContent = "Opening Google...";
  document.getElementById("drive-status").className = "status processing";

  chrome.runtime.sendMessage({ type: "getDriveToken" });

  document.getElementById("drive-status").textContent =
    "Auth started. Close this popup, authorize, then reopen.";
  setTimeout(() => window.close(), 2000);
}

async function getDriveAccount(token) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.email || data.name || "Connected";
  } catch {
    return "Connected";
  }
}

async function testDriveToken(token) {
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function detectCurrentCourse() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("udemy.com/course/")) {
      document.getElementById("course-url").value = tab.url;
    }
  } catch (e) {
    console.error("Failed to detect course:", e);
  }
}

function getBackendUrl() {
  return document.getElementById("backend-url").value.replace(/\/$/, "") || DEFAULT_BACKEND;
}

function setStatus(id, message, type = "") {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = `status ${type}`;
}

async function startDownload() {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    setStatus("setup-status", "Enter your backend URL", "error");
    return;
  }

  const courseUrl = document.getElementById("course-url").value;
  if (!courseUrl) {
    setStatus("setup-status", "Enter a course URL or open a Udemy course page", "error");
    return;
  }

  if (!driveToken) {
    setStatus("setup-status", "Connect Google Drive first", "error");
    return;
  }

  saveSettings("backendUrl", backendUrl);

  const startBtn = document.getElementById("start-btn");
  startBtn.disabled = true;
  startBtn.textContent = "Fetching course...";
  setStatus("setup-status", "Fetching course data...", "processing");

  try {
    const courseData = await askContentForVideos();
    if (courseData.error) throw new Error(courseData.error);

    setStatus("setup-status", `Found ${courseData.totalVideos} videos. Sending to backend...`, "processing");

    const driveCredentials = { access_token: driveToken };

    const response = await fetch(`${backendUrl}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseData, driveCredentials }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error (${response.status}): ${text}`);
    }

    const data = await response.json();

    saveSettings("jobId", data.jobId);
    setStatus("setup-status", `Ready: ${data.totalVideos} videos found`, "success");
    document.getElementById("next-btn").classList.remove("hidden");
    showJobStatus(data.jobId);
  } catch (e) {
    setStatus("setup-status", e.message, "error");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start Download";
  }
}

async function processNext() {
  const backendUrl = getBackendUrl();
  const jobId = await getStoredJobId();

  if (!backendUrl || !jobId) {
    setStatus("setup-status", "No active job found", "error");
    return;
  }

  const nextBtn = document.getElementById("next-btn");
  nextBtn.disabled = true;
  nextBtn.textContent = "Processing...";
  setStatus("setup-status", "Downloading video...", "processing");

  try {
    const response = await fetch(`${backendUrl}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action: "next" }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to process video");
    }

    if (data.status === "completed") {
      setStatus("setup-status", "All videos downloaded!", "success");
      nextBtn.classList.add("hidden");
    } else if (data.status === "error") {
      setStatus("setup-status", `Error: ${data.error}`, "error");
    } else {
      setStatus("setup-status", `Done: ${data.completed}/${data.total}`, "success");
    }

    showJobStatus(jobId);
  } catch (e) {
    setStatus("setup-status", e.message, "error");
  } finally {
    nextBtn.disabled = false;
    nextBtn.textContent = "Process Next Video";
  }
}

async function showJobStatus(jobId) {
  const backendUrl = getBackendUrl();
  if (!backendUrl || !jobId) return;

  try {
    const response = await fetch(`${backendUrl}/api?jobId=${jobId}`);
    const job = await response.json();

    if (!response.ok) {
      throw new Error(job.error || "Failed to fetch status");
    }

    document.getElementById("job-course").textContent = job.courseTitle || "No active job";
    document.getElementById("progress-fill").style.width = `${job.progress}%`;
    document.getElementById("job-stats").textContent = `${job.completedVideos} / ${job.totalVideos} videos (${job.progress}%)`;

    const currentEl = document.getElementById("job-current");
    if (job.currentVideo) {
      currentEl.textContent = `Current: ${job.currentVideo}`;
      currentEl.classList.remove("hidden");
    } else {
      currentEl.classList.add("hidden");
    }

    const errorsEl = document.getElementById("job-errors");
    if (job.errors && job.errors.length > 0) {
      errorsEl.textContent = `Errors: ${job.errors.length}`;
      errorsEl.classList.remove("hidden");
    } else {
      errorsEl.classList.add("hidden");
    }

    const jobStatusEl = document.getElementById("job-status");
    if (job.status === "completed") {
      setStatus("job-status", "Complete!", "success");
      document.getElementById("continue-btn").classList.add("hidden");
    } else if (job.status === "ready") {
      setStatus("job-status", "Ready to continue", "processing");
      document.getElementById("continue-btn").classList.remove("hidden");
    } else if (job.status === "processing") {
      setStatus("job-status", "Processing...", "processing");
      document.getElementById("continue-btn").classList.add("hidden");
    }
  } catch (e) {
    setStatus("job-status", e.message, "error");
  }
}

async function refreshStatus() {
  const jobId = await getStoredJobId();
  if (jobId) {
    showJobStatus(jobId);
  } else {
    setStatus("job-status", "No job ID stored", "error");
  }
}

async function getStoredJobId() {
  return new Promise((resolve) => {
    chrome.storage.local.get("jobId", (data) => resolve(data.jobId || null));
  });
}

async function askContentForVideos() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return reject(new Error("No active tab"));

      chrome.tabs.sendMessage(
        tabs[0].id,
        { msg: "getCourseVideos" },
        (response) => {
          if (chrome.runtime.lastError) {
            const url = tabs[0].url || "";
            if (url.includes("udemy.com/course/")) {
              reject(new Error("Extension not loaded on this page. Please refresh the Udemy page and try again."));
            } else {
              reject(new Error("Open a Udemy course page first"));
            }
            return;
          }
          resolve(response);
        }
      );
    });
  });
}


