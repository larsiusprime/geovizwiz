import express from "express";
import cors from "cors";
import https from "https";

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
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 204
  })
);

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/hello", (_req, res) =>
  res.json({ message: "hello", env: process.env.NODE_ENV || "dev" })
);

app.post("/api/slack", async (req, res) => {
  if (!slackWebhook) {
    return res.status(500).json({ ok: false, error: "Slack webhook not configured" });
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
