// server.js  – hands the browser a realtime-session + key
import express from "express";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error("export OPENAI_API_KEY=sk-… first");

const app = express();
app.use(express.static("."));                       // serves index.html

app.get("/session", async (_req, res, next) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method : "POST",
      headers: {
        Authorization : `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model : "gpt-4o-realtime-preview-2025-06-03",
        voice : "alloy"                             // any built-in voice
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    res.json(data);                                 // { id, client_secret:{value:…} }
  } catch (e) { next(e); }
});

app.listen(3000, () => console.log("open  http://localhost:3000"));