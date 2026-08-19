import { createServer } from "node:http";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.WORKER_TOKEN || "";
const WORK_DIR = process.env.WORK_DIR || "/tmp/forgeai";
const jobs = new Map();
const queue = [];
let processing = false;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const authorized = (req) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-2000) || `ffmpeg exited with ${code}`)));
  });
}

async function processJob(job) {
  const dir = join(WORK_DIR, job.id);
  await mkdir(dir, { recursive: true });
  const output = join(dir, "final.mp4");
  try {
    job.status = "PROCESSING";
    job.stage = "PREPARING";
    job.updatedAt = new Date().toISOString();

    // The worker accepts scene assets as URLs. Provider-specific image/video/voice
    // generation stays in ForgeAI or future adapters; this worker owns heavy rendering.
    const assets = Array.isArray(job.scenes) ? job.scenes : [];
    const videos = assets.map((scene) => scene?.videoUrl).filter(Boolean);
    if (!videos.length) throw new Error("No rendered scene video assets were supplied");

    const listPath = join(dir, "concat.txt");
    const downloaded = [];
    job.stage = "DOWNLOADING_ASSETS";
    for (let i = 0; i < videos.length; i++) {
      const response = await fetch(videos[i]);
      if (!response.ok) throw new Error(`Failed to download scene ${i + 1}: HTTP ${response.status}`);
      const target = join(dir, `scene-${i + 1}.mp4`);
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
      downloaded.push(target);
    }
    await writeFile(listPath, downloaded.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"));

    job.stage = "RENDERING";
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output], dir);

    const data = await readFile(output);
    const sha256 = createHash("sha256").update(data).digest("hex");
    job.status = "COMPLETED";
    job.stage = "DONE";
    job.output = { filename: "final.mp4", size: data.length, sha256, base64: data.toString("base64") };
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    job.status = "FAILED";
    job.stage = "FAILED";
    job.error = error instanceof Error ? error.message : "Worker failed";
    job.updatedAt = new Date().toISOString();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    processing = false;
    setImmediate(drain);
  }
}

function drain() {
  if (processing || !queue.length) return;
  processing = true;
  const id = queue.shift();
  processJob(jobs.get(id));
}

const server = createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "forgeai-video-worker", queue: queue.length, processing });
    if (req.method === "POST" && req.url === "/jobs") {
      const payload = await body(req);
      if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) return json(res, 400, { error: "scenes is required" });
      const id = randomUUID();
      const job = { id, status: "QUEUED", stage: "QUEUED", scenes: payload.scenes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      jobs.set(id, job);
      queue.push(id);
      drain();
      return json(res, 202, { id, status: job.status, statusUrl: `/jobs/${id}` });
    }
    const match = req.method === "GET" && req.url?.match(/^\/jobs\/([^/]+)$/);
    if (match) {
      const job = jobs.get(match[1]);
      return job ? json(res, 200, job) : json(res, 404, { error: "Job not found" });
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
  }
});

server.listen(PORT, () => console.log(`ForgeAI video worker listening on :${PORT}`));
