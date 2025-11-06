import express from "express";
import cors from "cors";
import https from "https";

const DATA_PROXY_BASE_URL = normalizeBaseUrl(
  process.env.DATA_PROXY_BASE_URL ||
    process.env.BLOB_STORAGE_BASE ||
    "https://landeconomics.blob.core.windows.net/public-sharing-cle"
);

const rawAllowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const defaultAllowed = [
  "https://civicmapper.org",
  "https://www.civicmapper.org",
  "https://dev.civicmapper.org",
  "https://api.civicmapper.org",
  "https://api.dev.civicmapper.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

const allowAnyOrigin = rawAllowed.includes("*");
const allowedOrigins = allowAnyOrigin ? [] : rawAllowed.length ? rawAllowed : defaultAllowed;
const normalizedAllowed = new Set(allowedOrigins.map(normalizeOrigin));
console.log(
  "[CORS] Allowed origins:",
  allowAnyOrigin ? "*" : Array.from(normalizedAllowed).join(", ") || "(none)"
);

const slackWebhook = (process.env.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK || "").trim();
const slackWebhookConfigured = Boolean(slackWebhook);
let slackWebhookWarned = false;
const envLabel = deriveEnvLabel();

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin) return callback(null, true);
      if (normalizedAllowed.has(normalizeOrigin(origin))) {
        return callback(null, true);
      }
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(new Error("CORS"));
    },
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Range"],
    exposedHeaders: ["Content-Range", "Content-Length", "Content-Type"],
    optionsSuccessStatus: 204
  })
);

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/hello", (_req, res) =>
  res.json({ message: "hello", env: process.env.NODE_ENV || "dev" })
);

app.post(["/slack", "/api/slack"], async (req, res) => {
  if (!slackWebhookConfigured) {
    if (!slackWebhookWarned) {
      console.warn("[Slack] Webhook not configured; skipping post");
      slackWebhookWarned = true;
    }
    return res.status(204).send();
  }

  const body = typeof req.body === "object" && req.body ? { ...req.body } : {};
  if (typeof body.text === "string" && envLabel && !body.text.includes(`[${envLabel}]`)) {
    body.text = `[${envLabel}] ${body.text}`;
  }

  try {
    await postJson(slackWebhook, body);
    res.status(204).send();
  } catch (err) {
    console.error("[Slack] Failed to post", err);
    res.status(502).json({ ok: false, error: "Slack webhook error" });
  }
});

const dataRoutes = ["/data/:filename", "/api/data/:filename"];

for (const route of dataRoutes) {
  app.options(route, (_req, res) => res.sendStatus(204));
  app.get(route, handleDatasetProxy);
  app.head(route, handleDatasetProxy);
}

app.use((err, _req, res, next) => {
  if (err && err.message === "CORS") {
    return res.status(403).json({ ok: false, error: "CORS" });
  }
  return next(err);
});

app.listen(process.env.PORT || 8080, () => console.log("API up"));

function normalizeOrigin(origin = "") {
  return origin.replace(/\/+$/, "");
}

function normalizeBaseUrl(url = "") {
  return url.replace(/\/+$/, "");
}

function deriveEnvLabel() {
  const label =
    (process.env.APP_ENV_LABEL || process.env.APP_ENV || "").trim() ||
    (process.env.NODE_ENV === "production"
      ? "Prod"
      : process.env.NODE_ENV === "development"
        ? "Dev"
        : (process.env.NODE_ENV || "").trim());
  return label;
}

function postJson(url, payload) {
  const data = Buffer.from(JSON.stringify(payload ?? {}));
  return new Promise((resolve, reject) => {
    try {
      const target = new URL(url);
      const request = https.request(
        {
          method: "POST",
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length
          }
        },
        (response) => {
          response.on("data", () => {});
          response.on("end", () => {
            const status = response.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              resolve();
            } else {
              reject(new Error(`Slack HTTP ${status}`));
            }
          });
        }
      );
      request.on("error", reject);
      request.write(data);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function handleDatasetProxy(req, res) {
  try {
    const filename = (req.params?.filename || "").trim();
    if (!filename) {
      res.status(400).json({ ok: false, error: "Filename required" });
      return;
    }

    if (!isSafeFilename(filename)) {
      res.status(400).json({ ok: false, error: "Invalid filename" });
      return;
    }

    if (!DATA_PROXY_BASE_URL) {
      res.status(500).json({ ok: false, error: "DATA_PROXY_BASE_URL not configured" });
      return;
    }

    const blobUrl = new URL(`${DATA_PROXY_BASE_URL}/${filename}`);
    const headers = {};

    const rangeHeader = req.headers?.range;
    if (typeof rangeHeader === "string" && rangeHeader) {
      headers.Range = rangeHeader;
    }

    const proxyRequest = https.request(
      {
        method: req.method,
        protocol: blobUrl.protocol,
        hostname: blobUrl.hostname,
        port: blobUrl.port,
        path: `${blobUrl.pathname}${blobUrl.search}`,
        headers
      },
      (proxyResponse) => {
        const status = proxyResponse.statusCode ?? 502;
        res.status(status);

        copyHeader(proxyResponse.headers, res, "content-type", "Content-Type");
        copyHeader(proxyResponse.headers, res, "content-length", "Content-Length");
        copyHeader(proxyResponse.headers, res, "content-range", "Content-Range");
        copyHeader(proxyResponse.headers, res, "accept-ranges", "Accept-Ranges");
        copyHeader(proxyResponse.headers, res, "etag", "ETag");
        copyHeader(proxyResponse.headers, res, "last-modified", "Last-Modified");
        copyHeader(proxyResponse.headers, res, "cache-control", "Cache-Control");

        if (req.method === "HEAD") {
          proxyResponse.resume();
          proxyResponse.on("end", () => res.end());
          proxyResponse.on("error", () => res.end());
          return;
        }

        proxyResponse.pipe(res);
      }
    );

    proxyRequest.on("error", (error) => {
      console.error("[Dataset Proxy] Error fetching blob", error);
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: "Failed to fetch dataset" });
      } else {
        res.end();
      }
    });

    proxyRequest.end();
  } catch (error) {
    console.error("[Dataset Proxy] Unexpected error", error);
    res.status(500).json({ ok: false, error: "Dataset proxy error" });
  }
}

function isSafeFilename(name) {
  return /^[A-Za-z0-9_.\-]+$/.test(name);
}

function copyHeader(source, res, key, targetKey) {
  const value = source?.[key];
  if (value !== undefined) {
    res.setHeader(targetKey, value);
  }
}
