/*  npm i ws undici
 *
 *  Environment:
 *     export OPENAI_API_KEY=sk-...
 *
 *  Run:
 *     node server.js
 *  → http://localhost:3000
 */

const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const WebSocket   = require('ws');
const { Agent }   = require('undici');            // keeps TLS alive

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- OpenAI token cache / keep-alive agent ---------- */
const oaAgent       = new Agent({ keepAliveTimeout: 90_000 });
let   cachedToken   = null;        // last JSON blob from OpenAI
let   cachedExpiry  = 0;           // ms timestamp
let   mintInFlight  = null;        // Promise so calls collapse

async function _requestNewToken () {
  const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method    : 'POST',
    dispatcher: oaAgent,
    headers   : {
      Authorization : `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta' : 'realtime=v1'
    },
    body: JSON.stringify({
      model : 'gpt-4o-realtime-preview-2025-06-03',
      voice : 'verse'
    })
  });
  if (!r.ok) throw new Error(`OpenAI responded ${r.status}`);
  return r.json();
}

async function mintEphemeralToken (res) {
  try {
    const now = Date.now();

    // 1) still fresh? → hand it back immediately
    if (cachedToken && now < cachedExpiry - 5_000) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(cachedToken));
    }

    // 2) only one outbound request at a time
    if (!mintInFlight) {
      mintInFlight = _requestNewToken()
        .then(json => {
          cachedToken  = json;
          cachedExpiry = Date.now() + 55_000;   // valid 60 s, keep 5 s slack
          return json;
        })
        .finally(() => { mintInFlight = null; });
    }

    const token = await mintInFlight;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(token));
  } catch (err) {
    console.error('Failed to mint token', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'token_error' }));
  }
}

/* ---------------- HTTP ---------------- */
const server = http.createServer((req, res) => {
  // 1) Ephemeral-token endpoint
  if (req.url === '/session') return mintEphemeralToken(res);

  // 2) Static files
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, filePath.split('?')[0]); // strip query
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200); res.end(data);
  });
});

/* --------------- WebSocket signalling --------------- */
const wss   = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map();                           // roomId → [socketA,B...]

wss.on('connection', socket => {
  let joined = null;

  socket.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.join) {                                // first message → join room
      joined = msg.join;
      if (!rooms.has(joined)) rooms.set(joined, []);
      rooms.get(joined).push(socket);
      return;
    }

    if (joined) {                                  // relay everything else
      const peers = rooms.get(joined) || [];
      const payload = JSON.stringify(msg);
      peers.forEach(p => {
        if (p !== socket && p.readyState === WebSocket.OPEN) p.send(payload);
      });
    }
  });

  socket.on('close', () => {
    if (!joined) return;
    const peers = (rooms.get(joined) || []).filter(p => p !== socket);
    peers.length ? rooms.set(joined, peers) : rooms.delete(joined);
  });
});

server.listen(PORT, () =>
  console.log(`🔊  http://localhost:${PORT}`)
);