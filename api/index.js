const UDEMY_API = "https://www.udemy.com/api-2.0";

const JOBS_KEY = "jobs";

function getJobs() {
  if (typeof globalThis[JOBS_KEY] === "undefined") {
    globalThis[JOBS_KEY] = new Map();
  }
  return globalThis[JOBS_KEY];
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "GET") return handleGet(req, res);

  res.status(405).json({ error: "Method not allowed" });
};

async function handlePost(req, res) {
  try {
    const { courseUrl, cookies, driveCredentials, jobId, action } = req.body;

    if (action === "next" && jobId) {
      const job = await processJob(jobId);
      return res.status(200).json({
        status: job.status,
        currentVideo: job.currentVideo?.filename || null,
        completed: job.completedVideos,
        total: job.totalVideos,
        remaining: job.videoQueue?.length || 0,
        result: job.results?.[job.results.length - 1] || null,
      });
    }

    if (!courseUrl || !cookies || !driveCredentials?.access_token) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const slug = extractCourseSlug(courseUrl);
    if (!slug) return res.status(400).json({ error: "Invalid course URL" });

    const jobId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const course = await fetchCourse(slug, cookies);
    const totalVideos = course.chapters.reduce((s, c) => s + c.lectures.length, 0);

    const token = driveCredentials.access_token;
    const courseFolderId = await findOrCreateFolder(token, course.title);

    const chapterFolderIds = {};
    for (const ch of course.chapters) {
      chapterFolderIds[ch.id] = await findOrCreateFolder(token, ch.title, courseFolderId);
    }

    const videoQueue = [];
    for (const ch of course.chapters) {
      for (const lec of ch.lectures) {
        videoQueue.push({
          chapterId: ch.id,
          chapterTitle: ch.title,
          lectureId: lec.id,
          lectureTitle: lec.title,
          filename: `${lec.title}.mp4`,
          url: lec.url,
        });
      }
    }

    const jobs = getJobs();
    jobs.set(jobId, {
      id: jobId,
      status: "ready",
      courseUrl,
      courseId: course.id,
      courseTitle: course.title,
      token,
      cookies,
      totalVideos,
      completedVideos: 0,
      currentVideo: null,
      courseFolderId,
      chapterFolderIds,
      videoQueue,
      errors: [],
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({ jobId, courseTitle: course.title, totalVideos, status: "ready" });
  } catch (e) {
    console.error("POST /api/start error:", e);
    res.status(500).json({ error: e.message });
  }
}

async function handleGet(req, res) {
  try {
    const jobId = req.query.jobId;
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const jobs = getJobs();
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    res.status(200).json({
      id: job.id,
      status: job.status,
      courseTitle: job.courseTitle,
      totalVideos: job.totalVideos,
      completedVideos: job.completedVideos,
      progress: job.totalVideos ? Math.round((job.completedVideos / job.totalVideos) * 100) : 0,
      currentVideo: job.currentVideo?.filename || null,
      errors: job.errors || [],
      resultsCount: (job.results || []).length,
      updatedAt: job.updatedAt,
    });
  } catch (e) {
    console.error("GET /api/status error:", e);
    res.status(500).json({ error: e.message });
  }
}

async function processJob(jobId) {
  const jobs = getJobs();
  const job = jobs.get(jobId);
  if (!job) throw new Error("Job not found");

  if (job.status === "completed" || !job.videoQueue?.length) {
    job.status = "completed";
    job.updatedAt = new Date().toISOString();
    return job;
  }

  const video = job.videoQueue[0];
  job.status = "processing";
  job.currentVideo = video;
  job.updatedAt = new Date().toISOString();

  const folderId = job.chapterFolderIds[video.chapterId];

  try {
    const buffer = await downloadVideo(video.url, job.cookies);
    const result = await uploadToDrive(job.token, folderId, video.filename, buffer);

    job.videoQueue.shift();
    job.completedVideos = (job.completedVideos || 0) + 1;
    job.results = [...(job.results || []), result];
    job.currentVideo = null;
    job.status = job.videoQueue.length ? "ready" : "completed";
    job.updatedAt = new Date().toISOString();
  } catch (e) {
    console.error("Process video error:", e);
    job.errors = [...(job.errors || []), { filename: video.filename, error: e.message }];
    job.currentVideo = null;
    job.status = "ready";
    job.updatedAt = new Date().toISOString();
    throw e;
  }

  return job;
}

function extractCourseSlug(url) {
  const match = url.match(/course\/([^/?]+)/);
  return match ? match[1] : null;
}

async function udemyRequest(path, cookies) {
  const res = await fetch(`${UDEMY_API}${path}`, {
    headers: {
      Cookie: cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`Udemy API error: ${res.status}`);
  return res.json();
}

async function fetchCourse(slug, cookies) {
  const info = await udemyRequest(`/courses/${slug}/`, cookies);
  const params = new URLSearchParams({
    "fields[asset]": "title,filename,media_sources",
    "fields[chapter]": "title",
    "fields[lecture]": "title,asset",
    page_size: "1000",
  });
  const curriculum = await udemyRequest(
    `/courses/${info.id}/cached-subscriber-curriculum-items?${params}`,
    cookies
  );

  const chapters = [];
  let current = null;
  for (const item of curriculum.results || curriculum) {
    if (item._class === "chapter") {
      current = { id: item.id, title: sanitize(item.title), lectures: [] };
      chapters.push(current);
    } else if (current && item._class === "lecture" && item.asset?.media_sources) {
      const video = getBestVideo(item.asset.media_sources);
      if (video) {
        current.lectures.push({
          id: item.id,
          title: sanitize(item.title),
          filename: item.asset.filename || `${item.title}.mp4`,
          url: video.file,
        });
      }
    }
  }

  return { id: info.id, title: info.title, chapters };
}

function getBestVideo(sources) {
  const mp4 = sources.filter((m) => m.type === "video/mp4");
  if (mp4.length) {
    mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
    return mp4[0];
  }
  return sources.find((m) => m.type.startsWith("video/")) || null;
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

async function driveRequest(path, token, method = "GET", body = null, contentType = null) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(`https://www.googleapis.com${path}`, {
    method,
    headers,
    body: body || undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API error (${res.status}): ${err}`);
  }
  return res.json();
}

async function findOrCreateFolder(token, name, parent) {
  const q = parent
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;

  const res = await driveRequest(
    `/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)&pageSize=1`,
    token
  );

  if (res.files.length > 0) return res.files[0].id;

  const folder = await driveRequest(
    "/drive/v3/files?fields=id",
    token,
    "POST",
    JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
    }),
    "application/json"
  );

  return folder.id;
}

async function uploadToDrive(token, folderId, filename, videoBuffer) {
  const metadata = { name: filename, parents: [folderId] };
  const boundary = "upload_" + Date.now();

  const header = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: video/mp4",
    "",
  ].join("\r\n");

  const footer = `\r\n--${boundary}--\r\n`;

  const fullBuffer = Buffer.concat([
    Buffer.from(header),
    videoBuffer,
    Buffer.from(footer),
  ]);

  return driveRequest(
    "/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    token,
    "POST",
    fullBuffer,
    `multipart/related; boundary=${boundary}`
  );
}

async function downloadVideo(url, cookies) {
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
  if (cookies) headers.Cookie = cookies;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  return Buffer.from(await res.arrayBuffer());
}
