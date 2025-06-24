// server.js  – create the session once, reuse its client_secret
import express from "express";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error("export OPENAI_API_KEY=sk-… first");

const app = express();
app.use(express.static("."));                       // serves index.html

let session;                                        // { id, client_secret:{value:…}}
async function getSession() {
  if (session) return session;                      // already have one
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method : "POST",
    headers: {
      Authorization : `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model : "gpt-4o-realtime-preview-2025-06-03",
      voice : "alloy"
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  console.log("SERVER: created shared session", data.id);
  session = data;                                   // cache for later calls
  return session;
}

app.get("/session", async (_req, res, next) => {
  try {
    console.log("SERVER: /session requested");
    const {client_secret} = await getSession();
    res.json({client_secret});                      // {value:"sk-..."}
  } catch (e) { next(e); }
});

app.listen(3000, () => console.log("listening on port 3000"));