const jobs = new Map();

function useKV() {
  try {
    require("@vercel/kv");
    return true;
  } catch {
    return false;
  }
}

async function getJob(jobId) {
  if (useKV()) {
    const { kv } = require("@vercel/kv");
    return kv.get(`job:${jobId}`);
  }
  return jobs.get(jobId) || null;
}

async function setJob(jobId, data, ttl = 86400) {
  if (useKV()) {
    const { kv } = require("@vercel/kv");
    await kv.set(`job:${jobId}`, data, { ex: ttl });
  } else {
    jobs.set(jobId, data);
  }
}

async function deleteJob(jobId) {
  if (useKV()) {
    const { kv } = require("@vercel/kv");
    await kv.del(`job:${jobId}`);
  } else {
    jobs.delete(jobId);
  }
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
