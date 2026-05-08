const { google } = require("googleapis");

const drive = google.drive("v3");

function getAuth(credentials) {
  if (credentials.type === "service_account") {
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  if (credentials.access_token) {
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: credentials.access_token });
    return oauth2;
  }

  throw new Error("Invalid credentials. Provide service_account or access_token");
}

async function findOrCreateFolder(auth, folderName, parentId = null) {
  const query = parentId
    ? `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;

  const res = await drive.files.list({
    auth,
    q: query,
    spaces: "drive",
    fields: "files(id, name)",
    pageSize: 1,
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  const folderMetadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };

  const folder = await drive.files.create({
    auth,
    resource: folderMetadata,
    fields: "id",
  });

  return folder.data.id;
}

async function createFolderStructure(auth, courseTitle, chapters) {
  const courseFolderId = await findOrCreateFolder(auth, courseTitle);
  const chapterFolderIds = {};

  for (const chapter of chapters) {
    const chapterFolderId = await findOrCreateFolder(
      auth,
      chapter.title,
      courseFolderId
    );
    chapterFolderIds[chapter.id] = chapterFolderId;
  }

  return { courseFolderId, chapterFolderIds };
}

async function uploadVideo(auth, folderId, filename, videoBuffer) {
  const response = await drive.files.create({
    auth,
    resource: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: "video/mp4",
      body: Buffer.isBuffer(videoBuffer)
        ? Buffer.from(videoBuffer)
        : videoBuffer,
    },
    fields: "id, name, webViewLink",
  });

  return response.data;
}

async function uploadVideoStream(auth, folderId, filename, stream, fileSize) {
  const response = await drive.files.create({
    auth,
    resource: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: "video/mp4",
      body: stream,
    },
    fields: "id, name, webViewLink",
  });

  return response.data;
}

async function downloadVideo(videoUrl, cookies) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  if (cookies) {
    headers.Cookie = cookies;
  }

  const response = await fetch(videoUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

async function processVideoSequentially(
  auth,
  folderId,
  videoUrl,
  filename,
  cookies,
  onProgress
) {
  onProgress?.({ status: "downloading", filename });

  const videoBuffer = await downloadVideo(videoUrl, cookies);

  onProgress?.({
    status: "uploading",
    filename,
    size: videoBuffer.length,
  });

  const result = await uploadVideo(auth, folderId, filename, videoBuffer);

  onProgress?.({ status: "completed", filename, fileId: result.id });

  return result;
}

module.exports = {
  getAuth,
  findOrCreateFolder,
  createFolderStructure,
  uploadVideo,
  uploadVideoStream,
  downloadVideo,
  processVideoSequentially,
};
