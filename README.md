# Oxorak Community YouTube Upload

This adds public video uploads to the existing Oxorak page without changing the existing screen recorder.

## Flow

Visitor -> Upload Video -> Node server -> YouTube PRIVATE -> You review -> Publish -> Community VR Transmissions.

## 1. Create a Google Cloud project

Open Google Cloud Console and enable **YouTube Data API v3**.

Create OAuth 2.0 credentials for a **Web application**.

Authorized redirect URI:

`https://YOUR-NODE-SERVER/oauth2callback`

For local testing:

`http://localhost:3000/oauth2callback`

Use the `youtube.upload` OAuth scope.

## 2. Set environment variables

Set:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `PUBLIC_SERVER_URL` (optional if YOUTUBE_REDIRECT_URI is set)
- `ADMIN_KEY`

Example:

YOUTUBE_REDIRECT_URI=https://oxorak-youtube.onrender.com/oauth2callback
PUBLIC_SERVER_URL=https://oxorak-youtube.onrender.com
ADMIN_KEY=make-a-long-random-secret

Do NOT put the client secret or ADMIN_KEY into the HTML.

## 3. Install and run

`npm install`

`npm start`

Then open:

`https://YOUR-NODE-SERVER/auth/youtube`

Sign into the Google/YouTube account that owns the Oxorak channel and approve the `youtube.upload` permission.

The server stores the refresh token in:

`data/youtube-token.json`

Keep that file private.

## 4. Connect the HTML page

If your HTML is served by the same Node server, the upload button works with the default API base.

If the HTML stays on spidyradioon.is-great.net and the Node server is elsewhere, add this before the upload script:

`<script>window.OX_YOUTUBE_API="https://YOUR-NODE-SERVER";</script>`

## 5. Approve videos

Open:

`https://YOUR-NODE-SERVER/admin?key=YOUR_ADMIN_KEY`

Pending videos are shown with Publish and Reject buttons.

Publish changes the YouTube privacy status from private to public.

Rejected videos remain private on YouTube until you delete them manually in YouTube Studio.

## Notes

- The public never receives your Google credentials.
- The public upload endpoint does not need Google login.
- Uploaded videos are private until you approve them.
- The existing screen recorder in the page remains unchanged.
- YouTube quota and Google/YouTube policies still apply.
