import express from "express";
import cors from "cors";
const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
const app = express();
app.use(cors({ origin: (o, cb)=> !o||!allowed.length||allowed.includes(o) ? cb(null,true) : cb(new Error("CORS")) }));
app.get("/healthz", (_req,res)=>res.json({ok:true}));
app.get("/api/hello", (_req,res)=>res.json({message:"hello", env:process.env.NODE_ENV||"dev"}));
app.listen(process.env.PORT||8080, ()=>console.log("API up"));
