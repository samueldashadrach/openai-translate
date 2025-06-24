/*  npm i ws  (Node 18+ → global fetch is available)
 *
 *  Environment:
 *     export OPENAI_API_KEY=sk-...
 *
 *  Run:
 *     node server.js
 *  -> http://localhost:3000
 */

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const WebSocket = require('ws');

const PORT       = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- HTTP ---------------- */
const server = http.createServer(async (req, res) => {
  // 1) Ephemeral-token endpoint for the browser
  if (req.url === '/session') {
    return mintEphemeralToken(res);
  }

  // 2) Static files
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('File not found'); return; }
    res.writeHead(200);
    res.end(data);
  });
});

async function mintEphemeralToken(res) {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type' : 'application/json',
        'OpenAI-Beta'  : 'realtime=v1'            // beta header (June ’25)
      },
      body: JSON.stringify({
        model : 'gpt-4o-realtime-preview-2025-06-03',
        voice : 'verse'
      })
    });
    const json = await r.json();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  } catch (e) {
    console.error('Error minting token', e);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'token_error' }));
  }
}

/* --------------- WebSocket --------------- */
const wss   = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map();                    // roomId → [socketA, socketB]

wss.on('connection', socket => {
  let joinedRoom = null;

  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    /* first message: { join:"room" } */
    if (msg.join) {
      joinedRoom = msg.join;
      if (!rooms.has(joinedRoom)) rooms.set(joinedRoom, []);
      rooms.get(joinedRoom).push(socket);
      return;
    }

    /* forward everything else to the other peer */
    if (joinedRoom) {
      const peers   = rooms.get(joinedRoom) || [];
      const payload = JSON.stringify(msg);
      peers.forEach(peer => {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) {
          peer.send(payload);
        }
      });
    }
  });

  socket.on('close', () => {
    if (!joinedRoom) return;
    const peers = (rooms.get(joinedRoom) || []).filter(p => p !== socket);
    if (peers.length) rooms.set(joinedRoom, peers);
    else rooms.delete(joinedRoom);
  });
});

server.listen(PORT, () =>
  console.log(`🔊  http://localhost:${PORT}`)
);