# Oxorak YouTube Upload — OAuth state fix

This update replaces the in-memory Express session OAuth state check with a signed, time-limited stateless OAuth state. This is more reliable on Render because the Google callback does not depend on the same server session instance.

Keep these Render variables:
- YOUTUBE_CLIENT_ID
- YOUTUBE_CLIENT_SECRET
- YOUTUBE_REDIRECT_URI=https://oxorak-youtube-upload.onrender.com/oauth2callback
- SESSION_SECRET (recommended: a long random value)
- ADMIN_KEY (recommended for admin endpoints)

Deploy this version, wait for Live, then start a NEW connection from `/auth/youtube`. Do not reuse an old Google callback URL.
