const express = require("express");
const app = express();

app.use(express.json({ limit: "10mb" }));

const UDEMY_BASE = "https://www.udemy.com";
const UDEMY_API = "https://www.udemy.com/api-2.0";
const jobs = new Map();

app.post("/api", async (req, res) => {
  try {
    const { courseData, driveCredentials, jobId: existingJobId, action } = req.body;

    if (action === "next" && existingJobId) {
      const job = await processJob(existingJobId);
      return res.json({
        status: job.status,
        currentVideo: job.currentVideo?.filename || null,
        completed: job.completedVideos,
        total: job.totalVideos,
        remaining: job.videoQueue?.length || 0,
        result: job.results?.[job.results.length - 1] || null,
      });
    }

    if (!courseData || !courseData.chapters || !driveCredentials?.access_token) {
      return res.status(400).json({ error: "Missing required fields: courseData, driveCredentials" });
    }

    const jobId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const totalVideos = courseData.chapters.reduce((s, c) => s + c.lectures.length, 0);
    const token = driveCredentials.access_token;
    const courseFolderId = await findOrCreateFolder(token, courseData.courseTitle);

    const chapterFolderIds = {};
    for (const ch of courseData.chapters) {
      chapterFolderIds[ch.id] = await findOrCreateFolder(token, ch.title, courseFolderId);
    }

    const videoQueue = [];
    for (const ch of courseData.chapters) {
      for (const lec of ch.lectures) {
        videoQueue.push({
          chapterId: ch.id,
          chapterTitle: ch.title,
          lectureId: lec.id,
          lectureTitle: lec.title,
          filename: lec.filename || `${lec.title}.mp4`,
          url: lec.url,
        });
      }
    }

    jobs.set(jobId, {
      id: jobId, status: "ready", courseData, courseId: courseData.courseId, courseTitle: courseData.courseTitle,
      token, totalVideos, completedVideos: 0, currentVideo: null,
      courseFolderId, chapterFolderIds, videoQueue, errors: [], results: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    res.json({ jobId, courseTitle: courseData.courseTitle, totalVideos, status: "ready" });
  } catch (e) {
    console.error("POST error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api", async (req, res) => {
  try {
    const jobId = req.query.jobId;
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    res.json({
      id: job.id, status: job.status, courseTitle: job.courseTitle,
      totalVideos: job.totalVideos, completedVideos: job.completedVideos,
      progress: job.totalVideos ? Math.round((job.completedVideos / job.totalVideos) * 100) : 0,
      currentVideo: job.currentVideo?.filename || null,
      errors: job.errors || [], resultsCount: (job.results || []).length,
      updatedAt: job.updatedAt,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "completed" || !job.videoQueue?.length) {
    job.status = "completed"; job.updatedAt = new Date().toISOString(); return job;
  }

  const video = job.videoQueue[0];
  job.status = "processing"; job.currentVideo = video; job.updatedAt = new Date().toISOString();

  try {
    const buffer = await downloadVideo(video.url);
    const result = await uploadToDrive(job.token, job.chapterFolderIds[video.chapterId], video.filename, buffer);
    job.videoQueue.shift(); job.completedVideos++; job.results = [...(job.results || []), result];
    job.currentVideo = null; job.status = job.videoQueue.length ? "ready" : "completed";
    job.updatedAt = new Date().toISOString();
  } catch (e) {
    job.errors = [...(job.errors || []), { filename: video.filename, error: e.message }];
    job.currentVideo = null; job.status = "ready"; job.updatedAt = new Date().toISOString();
    throw e;
  }
  return job;
}

function extractCourseSlug(url) {
  const m = url.match(/course\/([^/?]+)/);
  return m ? m[1] : null;
}

async function udemyRequest(path, cookies) {
  const headers = {
    Cookie: cookies,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://www.udemy.com/",
    "Origin": "https://www.udemy.com",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
  };

  const accessToken = cookies?.match(/access_token=([^;]+)/)?.[1];
  const clientId = cookies?.match(/client_id=([^;]+)/)?.[1];
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (clientId) headers["X-Udemy-Client-Id"] = clientId;

  const res = await fetch(`${UDEMY_API}${path}`, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Udemy API ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchCourse(slug, cookies) {
  let info;
  try {
    info = await udemyRequest(`/courses/${slug}/`, cookies);
  } catch (e) {
    try {
      return await scrapeCoursePage(slug, cookies);
    } catch (e2) {
      throw new Error(`API: ${e.message}. Scrape: ${e2.message}`);
    }
  }

  if (!info || !info.id) {
    try {
      return await scrapeCoursePage(slug, cookies);
    } catch (e2) {
      throw new Error(`Course info missing ID. API keys: ${Object.keys(info||{}).join(", ")}`);
    }
  }

  const params = new URLSearchParams({
    "fields[asset]": "title,filename,media_sources", "fields[chapter]": "title",
    "fields[lecture]": "title,asset,media_sources", page_size: "1000",
  });
  const curriculum = await udemyRequest(`/courses/${info.id}/cached-subscriber-curriculum-items?${params}`, cookies);
  const chapters = []; let current = null;

  const items = curriculum.results || curriculum;
  if (items.length === 0) {
    console.log("Curriculum empty, full response keys:", Object.keys(curriculum));
  }

  for (const item of items) {
    if (item._class === "chapter") {
      current = { id: item.id, title: sanitize(item.title), lectures: [] };
      chapters.push(current);
    } else if (current && item._class === "lecture") {
      const asset = item.asset;
      if (asset && asset.media_sources && asset.media_sources.length > 0) {
        const v = getBestVideo(asset.media_sources);
        if (v && v.file) {
          current.lectures.push({
            id: item.id, title: sanitize(item.title),
            filename: (asset.filename || item.title) + ".mp4", url: v.file,
          });
        }
      }
    }
  }

  const total = chapters.reduce((s, c) => s + c.lectures.length, 0);

  return { id: info.id, title: info.title, chapters };
}

async function scrapeCoursePage(slug, cookies) {
  const url = `https://www.udemy.com/course/${slug}/`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`Scrape: status ${res.status}`);
  const html = await res.text();

  const titleMatch = html.match(/"title":"([^"]+)"/) || html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? titleMatch[1].replace(/\\/g, "") : slug;

  const idMatch = html.match(/courseId["\s:=]+(\d+)/);
  if (!idMatch) throw new Error("Could not find course ID in page");

  const params = new URLSearchParams({
    "fields[asset]": "title,filename,media_sources",
    "fields[chapter]": "title",
    "fields[lecture]": "title,asset,media_sources",
    page_size: "1000",
  });

  try {
    const curriculum = await udemyRequest(`/courses/${idMatch[1]}/cached-subscriber-curriculum-items?${params}`, cookies);
    const chapters = []; let current = null;
    const items = curriculum.results || curriculum;

    for (const item of items) {
      if (item._class === "chapter") {
        current = { id: item.id, title: sanitize(item.title), lectures: [] };
        chapters.push(current);
      } else if (current && item._class === "lecture") {
        const asset = item.asset;
        if (asset && asset.media_sources && asset.media_sources.length > 0) {
          const v = getBestVideo(asset.media_sources);
          if (v && v.file) {
            current.lectures.push({
              id: item.id, title: sanitize(item.title),
              filename: (asset.filename || item.title) + ".mp4", url: v.file,
            });
          }
        }
      }
    }

    const total = chapters.reduce((s, c) => s + c.lectures.length, 0);
    return { id: idMatch[1], title, chapters };
  } catch (e) {
    throw new Error(`Scraped course but curriculum API failed: ${e.message}`);
  }
}

function getBestVideo(sources) {
  const mp4 = sources.filter(m => m.type === "video/mp4");
  if (mp4.length) { mp4.sort((a, b) => (b.height || 0) - (a.height || 0)); return mp4[0]; }
  return sources.find(m => m.type.startsWith("video/")) || null;
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

async function driveRequest(path, token, method = "GET", body = null, contentType = null) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(`https://www.googleapis.com${path}`, { method, headers, body: body || undefined });
  if (!res.ok) throw new Error(`Drive API error (${res.status}): ${await res.text()}`);
  return res.json();
}

async function findOrCreateFolder(token, name, parent) {
  const q = parent
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
  const r = await driveRequest(`/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)&pageSize=1`, token);
  if (r.files.length > 0) return r.files[0].id;
  const f = await driveRequest("/drive/v3/files?fields=id", token, "POST",
    JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) }),
    "application/json");
  return f.id;
}

async function uploadToDrive(token, folderId, filename, videoBuffer) {
  const boundary = "up_" + Date.now();
  const header = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  return driveRequest("/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", token, "POST",
    Buffer.concat([Buffer.from(header), videoBuffer, Buffer.from(footer)]),
    `multipart/related; boundary=${boundary}`);
}

async function downloadVideo(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://www.udemy.com/",
    },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = app;
