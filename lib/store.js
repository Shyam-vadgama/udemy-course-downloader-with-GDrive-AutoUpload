const jobs = new Map();

async function getJob(jobId) {
  return jobs.get(jobId) || null;
}

async function setJob(jobId, data) {
  jobs.set(jobId, data);
}

async function deleteJob(jobId) {
  jobs.delete(jobId);
}

async function updateJob(jobId, updates) {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found");

  const updated = { ...job, ...updates };
  await setJob(jobId, updated);
  return updated;
}

async function createJob(jobData) {
  const jobId =
    Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

  const job = {
    id: jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalVideos: 0,
    completedVideos: 0,
    currentVideo: null,
    errors: [],
    results: [],
    ...jobData,
  };

  await setJob(jobId, job);
  return job;
}

module.exports = {
  getJob,
  setJob,
  deleteJob,
  updateJob,
  createJob,
};
