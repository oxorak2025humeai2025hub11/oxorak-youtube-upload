// Oxorak Community YouTube Upload Server
// Public uploads -> YouTube PRIVATE -> admin review -> PUBLIC.
// Existing browser screen recorder is not modified by this server.

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const session = require("express-session");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const STATE_SECRET = process.env.SESSION_SECRET || process.env.YOUTUBE_CLIENT_SECRET || "change-me";
const MAX_UPLOAD = 20 * 1024 * 1024 * 1024; // 20 GB
const DATA_DIR = path.join(__dirname, "data");
const TMP_DIR = path.join(__dirname, "tmp");
const DB_FILE = path.join(DATA_DIR, "submissions.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");

app.use(cors({
  origin: true,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "X-Admin-Key"]
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000 }
}));

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_UPLOAD },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only video files are accepted."));
    }
    cb(null, true);
  }
});

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return []; }
}
function writeDb(rows) {
  fs.writeFileSync(DB_FILE, JSON.stringify(rows, null, 2));
}
function adminOk(req) {
  return ADMIN_KEY && (
    req.get("X-Admin-Key") === ADMIN_KEY ||
    req.query.key === ADMIN_KEY ||
    req.body?.key === ADMIN_KEY
  );
}

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const redirectUri = process.env.YOUTUBE_REDIRECT_URI ||
  `${process.env.PUBLIC_SERVER_URL || `http://localhost:${PORT}`}/oauth2callback`;

if (!clientId || !clientSecret) {
  console.warn("YouTube OAuth is not configured yet. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.");
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const TOKEN_FILE = path.join(DATA_DIR, "youtube-token.json");
if (fs.existsSync(TOKEN_FILE)) {
  try { oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"))); }
  catch (e) { console.warn("Could not read YouTube token:", e.message); }
}
oauth2Client.on("tokens", tokens => {
  let old = {};
  try { old = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch {}
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...old, ...tokens }, null, 2));
});

const youtube = google.youtube({ version: "v3", auth: oauth2Client });

app.get("/auth/youtube", (req, res) => {
  if (!clientId || !clientSecret) {
    return res.status(500).send("Configure YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first.");
  }
  // Stateless OAuth state: avoids Render session-store issues during the Google redirect.
  const nonce = crypto.randomBytes(24).toString("hex");
  const issued = Date.now().toString();
  const payload = `${issued}.${nonce}`;
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  const state = `${payload}.${sig}`;
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    response_type: "code",
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
    state,
    redirect_uri: redirectUri
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    if (!req.query.code) {
      return res.status(400).send("Google did not return an authorization code.");
    }
    const state = String(req.query.state || "");
    const parts = state.split(".");
    if (parts.length !== 3) {
      return res.status(400).send("Invalid OAuth state. Please start the connection again.");
    }
    const [issued, nonce, sig] = parts;
    const payload = `${issued}.${nonce}`;
    const expected = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
    if (!/^[0-9]+$/.test(issued) || Date.now() - Number(issued) > 10 * 60 * 1000 ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(400).send("Invalid or expired OAuth state. Please start the connection again.");
    }
    const { tokens } = await oauth2Client.getToken({ code: req.query.code, redirect_uri: redirectUri });
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    res.send(`
      <html><body style="font-family:Arial;background:#06111d;color:#dff;text-align:center;padding:50px">
      <h1 style="color:#74ffe7">✓ YouTube Connected</h1>
      <p>Oxorak Community uploads can now be sent to your YouTube channel.</p>
      <p>You may close this window.</p>
      </body></html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("YouTube authorization failed: " + e.message);
  }
});

function requireYouTube(res) {
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "YouTube OAuth credentials are not configured." });
    return false;
  }
  if (!oauth2Client.credentials?.refresh_token && !oauth2Client.credentials?.access_token) {
    res.status(503).json({ error: "YouTube is not connected. Open /auth/youtube first." });
    return false;
  }
  return true;
}

app.post("/api/youtube-upload", upload.single("video"), async (req, res) => {
  let tempPath = req.file?.path;
  try {
    if (!requireYouTube(res)) return;
    if (!req.file) return res.status(400).json({ error: "Choose a video first." });

    const title = String(req.body.title || "Community VR Video").trim().slice(0, 100);
    const submittedBy = String(req.body.submittedBy || "Community").trim().slice(0, 60);
    const description = String(req.body.description || "").trim().slice(0, 5000);

    const fullDescription =
      `Submitted by: ${submittedBy}\n\n${description}\n\n` +
      `Oxorak Community VR Transmission`;

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description: fullDescription,
          categoryId: "20" // Gaming
        },
        status: {
          privacyStatus: "private",
          embeddable: true,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(tempPath)
      }
    });

    const video = response.data;
    const rows = readDb();
    rows.push({
      id: video.id,
      title,
      submittedBy,
      description,
      status: "pending",
      uploadedAt: new Date().toISOString()
    });
    writeDb(rows);

    res.json({
      ok: true,
      id: video.id,
      status: "private",
      youtubeUrl: `https://www.youtube.com/watch?v=${video.id}`
    });
  } catch (e) {
    console.error("YouTube upload error:", e.response?.data || e);
    res.status(500).json({
      error: e.response?.data?.error?.message || e.message || "YouTube upload failed."
    });
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
});

// Public gallery: ONLY approved videos are returned.
app.get("/api/community-videos", (req, res) => {
  const videos = readDb()
    .filter(v => v.status === "published")
    .sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .slice(0, 100);
  res.json(videos);
});

// Admin list.
app.get("/api/admin/videos", (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json(readDb().sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
});

// Admin publish: changes YouTube privacy from private to public.
app.post("/api/admin/publish", async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: "Unauthorized." });
  if (!requireYouTube(res)) return;

  try {
    const id = String(req.body.id || "");
    const rows = readDb();
    const item = rows.find(v => v.id === id);
    if (!item) return res.status(404).json({ error: "Video not found." });

    await youtube.videos.update({
      part: ["status"],
      requestBody: {
        id,
        status: { privacyStatus: "public", embeddable: true }
      }
    });

    item.status = "published";
    item.publishedAt = new Date().toISOString();
    writeDb(rows);
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// Admin keeps a submission rejected locally. The private YouTube video remains
// in your channel until you delete it manually in YouTube Studio.
app.post("/api/admin/reject", (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: "Unauthorized." });
  const id = String(req.body.id || "");
  const rows = readDb();
  const item = rows.find(v => v.id === id);
  if (!item) return res.status(404).json({ error: "Video not found." });
  item.status = "rejected";
  item.rejectedAt = new Date().toISOString();
  writeDb(rows);
  res.json({ ok: true });
});

app.get("/admin", (req, res) => {
  if (!adminOk(req)) return res.status(401).send("Unauthorized. Use /admin?key=YOUR_ADMIN_KEY");
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Oxorak Video Approval</title>
<style>
body{font-family:Arial;background:#06111d;color:#dff;padding:25px}
h1{color:#74ffe7}.card{border:1px solid #18d7ff;background:#071526;border-radius:12px;padding:14px;margin:12px 0}
button{padding:8px 12px;border-radius:7px;border:1px solid #44e8ff;cursor:pointer;margin-right:6px}
.approve{background:#74ffe7}.reject{background:#222;color:#ff8b8b}
a{color:#74ffe7}
</style></head><body>
<h1>✦ Oxorak Community Video Approval ✦</h1>
<p>Private videos wait here until you approve them.</p>
<div id="list">Loading...</div>
<script>
const key = new URLSearchParams(location.search).get("key") || "";
async function load(){
 const r=await fetch("/api/admin/videos?key="+encodeURIComponent(key));
 const data=await r.json();
 document.getElementById("list").innerHTML=data.map(v=>\`
 <div class="card">
  <b>\${esc(v.title)}</b><br>
  Submitted by: \${esc(v.submittedBy)}<br>
  Status: <b>\${esc(v.status)}</b><br>
  <a target="_blank" href="https://www.youtube.com/watch?v=\${encodeURIComponent(v.id)}">Open YouTube</a>
  <p>\${esc(v.description||"")}</p>
  \${v.status==="pending" ? \`
    <button class="approve" onclick="act('publish','\${esc(v.id)}')">✓ Publish</button>
    <button class="reject" onclick="act('reject','\${esc(v.id)}')">Reject</button>
  \` : ""}
 </div>\`).join("") || "No submissions.";
}
async function act(endpoint,id){
 const r=await fetch("/api/admin/"+endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Key":key},body:JSON.stringify({id,key})});
 const d=await r.json(); if(!r.ok) alert(d.error||"Failed"); else load();
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
load();
</script></body></html>`);
});

app.get("/health", (req,res) => res.json({ ok:true, youtubeConnected:!!oauth2Client.credentials?.refresh_token }));

app.use(express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Video exceeds the 20 GB upload limit." });
  }
  res.status(400).json({ error: err.message || "Request failed." });
});

app.listen(PORT, () => {
  console.log(`Oxorak YouTube upload server running on port ${PORT}`);
  console.log(`OAuth redirect: ${redirectUri}`);
  console.log(`Connect YouTube at: /auth/youtube`);
});
