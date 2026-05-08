const UDEMY_BASE = "https://www.udemy.com";
const UDEMY_API = "https://www.udemy.com/api-2.0";

function extractCourseId(url) {
  const match = url.match(/course\/([^/?]+)/);
  return match ? match[1] : null;
}

async function fetchCourse(courseSlug, cookies) {
  const courseId = await resolveCourseId(courseSlug, cookies);
  if (!courseId) throw new Error("Could not resolve course ID");

  const curriculum = await fetchCurriculum(courseId, cookies);
  const courseInfo = await fetchCourseInfo(courseId, cookies);

  return {
    id: courseId,
    title: courseInfo.title || courseSlug,
    chapters: organizeCurriculum(curriculum),
  };
}

async function resolveCourseId(courseSlug, cookies) {
  const res = await fetch(`${UDEMY_API}/courses/${courseSlug}/`, {
    headers: {
      Cookie: cookies,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch course: ${res.status}`);
  const data = await res.json();
  return data.id;
}

async function fetchCourseInfo(courseId, cookies) {
  const res = await fetch(`${UDEMY_API}/courses/${courseId}/`, {
    headers: {
      Cookie: cookies,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch course info: ${res.status}`);
  return res.json();
}

async function fetchCurriculum(courseId, cookies) {
  const params = new URLSearchParams({
    "fields[asset]": "title,filename,media_sources,download_url",
    "fields[chapter]": "title",
    "fields[lecture]": "title,asset",
    "fields[quiz]": "title",
    "fields[practice]": "title",
    page_size: "1000",
  });

  const res = await fetch(
    `${UDEMY_API}/courses/${courseId}/cached-subscriber-curriculum-items?${params}`,
    {
      headers: {
        Cookie: cookies,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  );

  if (!res.ok)
    throw new Error(`Failed to fetch curriculum: ${res.status}`);
  return res.json();
}

function organizeCurriculum(curriculum) {
  const chapters = [];
  let currentChapter = null;

  for (const item of curriculum.results || curriculum) {
    if (item._class === "chapter") {
      currentChapter = {
        id: item.id,
        title: sanitizeFilename(item.title),
        lectures: [],
      };
      chapters.push(currentChapter);
    } else if (
      currentChapter &&
      item._class === "lecture" &&
      item.asset?.media_sources
    ) {
      const video = getBestVideo(item.asset.media_sources);
      if (video) {
        currentChapter.lectures.push({
          id: item.id,
          title: sanitizeFilename(item.title),
          filename: item.asset.filename || `${item.title}.mp4`,
          url: video.file,
          type: video.type,
        });
      }
    }
  }

  return chapters;
}

function getBestVideo(mediaSources) {
  const videos = mediaSources.filter(
    (m) => m.type === "video/mp4" || m.type === "application/x-mpegURL"
  );
  if (videos.length === 0) return null;

  const mp4 = videos.filter((m) => m.type === "video/mp4");
  if (mp4.length > 0) {
    mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
    return mp4[0];
  }

  return videos[0];
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

module.exports = {
  fetchCourse,
  extractCourseId,
  sanitizeFilename,
};
