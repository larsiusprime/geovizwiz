import express from "express";
import cors from "cors";

const app = express();

// allow local, dev, prod; tighten later
const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
  })
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from civicmapper API", env: process.env.NODE_ENV || "dev" });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`API listening on ${port}`));

