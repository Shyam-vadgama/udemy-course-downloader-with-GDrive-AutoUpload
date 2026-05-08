const { fetchCourse } = require("../lib/udemy");
const { getAuth, createFolderStructure, processVideoSequentially } = require("../lib/drive");
const { createJob, getJob, updateJob } = require("../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { courseUrl, cookies, driveCredentials, jobId, action } = req.body;

  try {
    if (action === "next" && jobId) {
      return await processNextVideo(jobId, res);
    }

    if (!courseUrl || !cookies || !driveCredentials) {
      return res.status(400).json({
        error: "Missing required fields: courseUrl, cookies, driveCredentials",
      });
    }

    return await startNewJob(courseUrl, cookies, driveCredentials, res);
  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

async function startNewJob(courseUrl, cookies, driveCredentials, res) {
  const courseSlug = courseUrl.split("/course/")[1]?.split("/")[0]?.split("?")[0];

  if (!courseSlug) {
    return res.status(400).json({ error: "Invalid course URL" });
  }

  const job = await createJob({
    courseUrl,
    courseSlug,
    status: "fetching",
  });

  const course = await fetchCourse(courseSlug, cookies);

  const totalVideos = course.chapters.reduce(
    (sum, ch) => sum + ch.lectures.length,
    0
  );

  const auth = getAuth(driveCredentials);
  const { courseFolderId, chapterFolderIds } = await createFolderStructure(
    auth,
    course.title,
    course.chapters
  );

  const videoQueue = [];
  for (const chapter of course.chapters) {
    for (const lecture of chapter.lectures) {
      videoQueue.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        lectureId: lecture.id,
        lectureTitle: lecture.title,
        filename: `${lecture.title}.mp4`,
        url: lecture.url,
        type: lecture.type,
      });
    }
  }

  const updatedJob = await updateJob(job.id, {
    courseId: course.id,
    courseTitle: course.title,
    status: "ready",
    totalVideos,
    completedVideos: 0,
    currentVideo: null,
    chapterFolderIds,
    courseFolderId,
    videoQueue,
    cookies,
    driveCredentials,
    updatedAt: new Date().toISOString(),
  });

  res.status(200).json({
    jobId: job.id,
    courseTitle: course.title,
    totalVideos,
    status: "ready",
    message: "Course fetched. Call with action:'next' to start processing",
  });
}

async function processNextVideo(jobId, res) {
  const job = await getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status === "completed") {
    return res.status(200).json({
      status: "completed",
      message: "All videos processed",
      results: job.results,
    });
  }

  if (!job.videoQueue || job.videoQueue.length === 0) {
    await updateJob(jobId, {
      status: "completed",
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      status: "completed",
      message: "All videos processed",
      results: job.results,
    });
  }

  const nextVideo = job.videoQueue[0];
  const remainingQueue = job.videoQueue.slice(1);

  await updateJob(jobId, {
    status: "processing",
    currentVideo: nextVideo,
    videoQueue: remainingQueue,
    updatedAt: new Date().toISOString(),
  });

  const auth = getAuth(job.driveCredentials);
  const folderId = job.chapterFolderIds[nextVideo.chapterId];

  let result;
  try {
    result = await processVideoSequentially(
      auth,
      folderId,
      nextVideo.url,
      nextVideo.filename,
      job.cookies,
      (progress) => {
        console.log(`[${jobId}] ${nextVideo.filename}: ${progress.status}`);
      }
    );

    const completedCount = (job.completedVideos || 0) + 1;
    const results = [...(job.results || []), result];

    await updateJob(jobId, {
      status: remainingQueue.length > 0 ? "ready" : "completed",
      completedVideos: completedCount,
      currentVideo: null,
      results,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({
      status: remainingQueue.length > 0 ? "ready" : "completed",
      currentVideo: nextVideo.filename,
      completed: completedCount,
      total: job.totalVideos,
      remaining: remainingQueue.length,
      result,
    });
  } catch (error) {
    const errors = [...(job.errors || []), { filename: nextVideo.filename, error: error.message }];

    await updateJob(jobId, {
      status: "ready",
      currentVideo: null,
      errors,
      videoQueue: [nextVideo, ...remainingQueue],
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({
      status: "error",
      currentVideo: nextVideo.filename,
      error: error.message,
      willRetry: true,
    });
  }
}
