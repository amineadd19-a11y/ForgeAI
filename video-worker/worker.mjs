import { createServer } from "node:http";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const { Pool } = pg;
const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.WORKER_TOKEN || "";
const WORK_DIR = process.env.WORK_DIR || "/tmp/forgeai";
const DATABASE_URL = process.env.DATABASE_URL || "";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || "auto";
const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL || "";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";

const jobs = new Map();
const queue = [];
let processing = false;
let pool = null;
let s3 = null;

if (DATABASE_URL) pool = new Pool({ connectionString: DATABASE_URL, max: 5, ssl: { rejectUnauthorized: false } });
if (S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) {
  s3 = new S3Client({ region: S3_REGION, endpoint: S3_ENDPOINT || undefined, forcePathStyle: Boolean(S3_ENDPOINT), credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });
}

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const authorized = (req) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;

async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }

async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS forgeai_video_jobs (id TEXT PRIMARY KEY,status TEXT NOT NULL,stage TEXT NOT NULL,scenes JSONB NOT NULL,output JSONB,error TEXT,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL)`);
}

async function saveJob(job) {
  if (!pool) return;
  await pool.query(`INSERT INTO forgeai_video_jobs (id,status,stage,scenes,output,error,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,stage=EXCLUDED.stage,scenes=EXCLUDED.scenes,output=EXCLUDED.output,error=EXCLUDED.error,updated_at=EXCLUDED.updated_at`, [job.id, job.status, job.stage, JSON.stringify(job.scenes), job.output ? JSON.stringify(job.output) : null, job.error || null, job.createdAt, job.updatedAt]);
}

async function loadJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  if (!pool) return null;
  const { rows } = await pool.query("SELECT * FROM forgeai_video_jobs WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, status: r.status, stage: r.stage, scenes: r.scenes, output: r.output, error: r.error, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
}

async function updateJob(job, patch) { Object.assign(job, patch, { updatedAt: new Date().toISOString() }); jobs.set(job.id, job); await saveJob(job); }

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-2000) || `ffmpeg exited with ${code}`)));
  });
}

async function persistOutput(jobId, data) {
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (!s3) return { filename: "final.mp4", size: data.length, sha256, persistent: false };
  const key = `forgeai/renders/${jobId}/final.mp4`;
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: data, ContentType: "video/mp4", Metadata: { sha256 } }));
  const url = S3_PUBLIC_BASE_URL ? `${S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}` : null;
  return { filename: "final.mp4", size: data.length, sha256, persistent: true, key, url };
}

async function processJob(job) {
  const dir = join(WORK_DIR, job.id); await mkdir(dir, { recursive: true }); const output = join(dir, "final.mp4");
  try {
    await updateJob(job, { status: "PROCESSING", stage: "PREPARING" });
    const videos = (Array.isArray(job.scenes) ? job.scenes : []).map((s) => s?.videoUrl).filter(Boolean);
    if (!videos.length) throw new Error("No rendered scene video assets were supplied");
    const listPath = join(dir, "concat.txt"); const downloaded = [];
    await updateJob(job, { stage: "DOWNLOADING_ASSETS" });
    for (let i = 0; i < videos.length; i++) {
      const response = await fetch(videos[i]);
      if (!response.ok) throw new Error(`Failed to download scene ${i + 1}: HTTP ${response.status}`);
      const target = join(dir, `scene-${i + 1}.mp4`); await writeFile(target, Buffer.from(await response.arrayBuffer())); downloaded.push(target);
    }
    await writeFile(listPath, downloaded.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"));
    await updateJob(job, { stage: "RENDERING" });
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output], dir);
    const data = await readFile(output); const persisted = await persistOutput(job.id, data);
    await updateJob(job, { status: "COMPLETED", stage: "DONE", output: persisted });
  } catch (error) { await updateJob(job, { status: "FAILED", stage: "FAILED", error: error instanceof Error ? error.message : "Worker failed" }); }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); processing = false; setImmediate(drain); }
}

function drain() { if (processing || !queue.length) return; processing = true; const id = queue.shift(); const job = jobs.get(id); if (job) processJob(job).catch(() => { processing = false; setImmediate(drain); }); else { processing = false; setImmediate(drain); } }

const server = createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "forgeai-video-worker", queue: queue.length, processing, database: Boolean(pool), storage: Boolean(s3) });
    if (req.method === "POST" && req.url === "/jobs") {
      const payload = await body(req); if (!Array.isArray(payload.scenes) || !payload.scenes.length) return json(res, 400, { error: "scenes is required" });
      const id = randomUUID(); const now = new Date().toISOString(); const job = { id, status: "QUEUED", stage: "QUEUED", scenes: payload.scenes, createdAt: now, updatedAt: now };
      jobs.set(id, job); await saveJob(job); queue.push(id); drain(); return json(res, 202, { id, status: job.status, statusUrl: `/jobs/${id}` });
    }
    const match = req.method === "GET" && req.url?.match(/^\/jobs\/([^/]+)$/);
    if (match) { const job = await loadJob(match[1]); return job ? json(res, 200, job) : json(res, 404, { error: "Job not found" }); }
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : "Internal error" }); }
});

initDb().then(() => server.listen(PORT, () => console.log(`ForgeAI video worker listening on :${PORT}`))).catch((error) => { console.error("Worker startup failed:", error); process.exit(1); });
