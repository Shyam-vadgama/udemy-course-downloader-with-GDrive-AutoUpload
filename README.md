# Udemy Snap

Download Udemy courses directly to Google Drive with proper folder structure.

## Features

- **Sequential Download**: Videos download one-by-one in order
- **Folder Structure**: `Course Name > Unit Name > Video.mp4`
- **No Local Storage**: Everything happens in the cloud via Vercel
- **Chrome Extension**: Auto-detects course, captures cookies
- **Progress Tracking**: Monitor download progress in real-time

## Architecture

```
Chrome Extension (popup)        Vercel Backend        Google Drive
     |                               |                     |
     |-- 1. Send course URL -------->|                     |
     |    + cookies + Drive creds    |                     |
     |                               |-- 2. Fetch course --|
     |                               |    curriculum       |
     |                               |-- 3. Create folders>|
     |<-- Job ID + video count ------|                     |
     |                               |                     |
     |-- 4. "Process next video" --->|-- 5. Download video |
     |                               |    from Udemy       |
     |                               |-- 6. Upload to Drive|
     |<-- Video done ----------------|                     |
     |-- Repeat step 4 ------------->|-- Until complete ---|
```

## Setup

### 1. Deploy Backend to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from project root
vercel
```

Or push to GitHub and connect to Vercel.

### 2. Get Google OAuth Client ID (One-time setup)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Google Drive API** and **Google+ API**
4. Go to **APIs & Services > Credentials > OAuth consent screen**
   - Choose "External", fill app name, add your email
   - Add scope: `https://www.googleapis.com/auth/drive`
5. Go to **Credentials > Create Credentials > OAuth client ID**
   - Application type: **Chrome Extension**
   - Copy your **Client ID**
6. Open `extension/manifest.json` and replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual client ID

### 3. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` folder

### 4. Use the Extension

1. Open any Udemy course page
2. Click the Udemy Snap extension icon
3. Enter your Vercel backend URL
4. Click **"Connect Google Drive"** - a popup will appear, sign in with your Google account
5. Once connected, click **"Start Download"**
6. Click **"Process Next Video"** repeatedly until complete

No manual token copying needed - it's all automatic.

## Folder Structure

```
Google Drive/
  Your Course Name/
    01 - Introduction/
      01 - Welcome.mp4
      02 - Overview.mp4
    02 - Basics/
      01 - Setup.mp4
      02 - First Steps.mp4
```

## API Endpoints

### POST `/api/start`

Start a new job or process next video.

**New job:**
```json
{
  "courseUrl": "https://www.udemy.com/course/course-name/",
  "cookies": "access_token=...;client_id=...",
  "driveCredentials": {"access_token": "ya29..."}
}
```

**Next video:**
```json
{
  "jobId": "abc123",
  "action": "next"
}
```

### GET `/api/status?jobId=abc123`

Get job progress.

## Notes

- Videos are processed sequentially, not in parallel
- Each video download + upload takes one API call
- Job state is stored in memory (use Vercel KV for persistence)
- Timeout: 60 seconds per video (Vercel Pro plan)

## License

MIT
