chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.msg === "getCourseVideos") {
    getCourseVideos()
      .then((data) => sendResponse(data))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function getCourseVideos() {
  const courseUrl = window.location.href;
  const slug = courseUrl.match(/course\/([^/?]+)/)?.[1];
  if (!slug) throw new Error("Not on a course page");

  const courseRes = await fetch(`https://www.udemy.com/api-2.0/courses/${slug}/`);
  if (!courseRes.ok) throw new Error(`API error: ${courseRes.status}`);
  const course = await courseRes.json();

  const params = new URLSearchParams({
    "fields[asset]": "title,filename,media_sources",
    "fields[chapter]": "title",
    "fields[lecture]": "title,asset,media_sources",
    "fields[quiz]": "title",
    "fields[practice]": "title",
    page_size: "1000",
  });

  const currRes = await fetch(
    `https://www.udemy.com/api-2.0/courses/${course.id}/cached-subscriber-curriculum-items?${params}`
  );
  if (!currRes.ok) throw new Error(`Curriculum API error: ${currRes.status}`);
  const curriculum = await currRes.json();

  const chapters = [];
  let current = null;

  for (const item of curriculum.results || curriculum) {
    if (item._class === "chapter") {
      current = { id: item.id, title: sanitize(item.title), lectures: [] };
      chapters.push(current);
    } else if (current && item._class === "lecture") {
      const asset = item.asset;
      if (asset && asset.media_sources?.length) {
        const video = getBestVideo(asset.media_sources);
        if (video?.file) {
          current.lectures.push({
            id: item.id,
            title: sanitize(item.title),
            filename: (asset.filename || item.title) + ".mp4",
            url: video.file,
          });
        }
      }
    }
  }

  const totalVideos = chapters.reduce((s, c) => s + c.lectures.length, 0);

  return {
    url: courseUrl,
    slug,
    courseTitle: course.title,
    courseId: course.id,
    totalVideos,
    chapters,
  };
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
