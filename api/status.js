const { getJob } = require("../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { jobId } = req.query;

  if (!jobId) {
    return res.status(400).json({ error: "Missing jobId parameter" });
  }

  try {
    const job = await getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const progress =
      job.totalVideos > 0
        ? Math.round((job.completedVideos / job.totalVideos) * 100)
        : 0;

    res.status(200).json({
      id: job.id,
      status: job.status,
      courseTitle: job.courseTitle || null,
      totalVideos: job.totalVideos,
      completedVideos: job.completedVideos,
      progress,
      currentVideo: job.currentVideo?.filename || null,
      errors: job.errors || [],
      resultsCount: (job.results || []).length,
      updatedAt: job.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
