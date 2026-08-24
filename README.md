# Oxorak YouTube Upload — OAuth state fix

This update replaces the in-memory Express session OAuth state check with a signed, time-limited stateless OAuth state. This is more reliable on Render because the Google callback does not depend on the same server session instance.

Keep these Render variables:
- YOUTUBE_CLIENT_ID
- YOUTUBE_CLIENT_SECRET
- YOUTUBE_REDIRECT_URI=https://oxorak-youtube-upload.onrender.com/oauth2callback
- SESSION_SECRET (recommended: a long random value)
- ADMIN_KEY (recommended for admin endpoints)

Deploy this version, wait for Live, then start a NEW connection from `/auth/youtube`. Do not reuse an old Google callback URL.


## Automatic YouTube playlist

Uploads are automatically added to playlist `PLBxZi83Hwl9A` (configurable with the `YOUTUBE_PLAYLIST_ID` Render environment variable). The OAuth connection must be re-authorized once with the `youtube.force-ssl` scope so the server can insert playlist items.
