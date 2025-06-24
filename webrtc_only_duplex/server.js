// tested, working!!!

// 1. npm install ws
// 2. node server.js
//
// ────────────────────────────────────────────────
//  • Listens on http://localhost:3000
//  • Static files  →  GET /…   (served from /public)
//  • WebSocket     →  WS  /ws  (nginx proxies this)
// ────────────────────────────────────────────────

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const WebSocket = require('ws');

const PORT       = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- HTTP: serve everything in /public ---------- */
const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('File not found'); return; }
    res.writeHead(200);
    res.end(data);
  });
});

/* ---------- WebSocket: one path only (/ws) ------------- */
const wss   = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map();                // roomId  →  [socketA, socketB]

wss.on('connection', socket => {
  let joinedRoom = null;

  socket.on('message', raw => {
    // raw may be a Buffer – convert to string first
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }                   // ignore malformed data

    /* First message must be { join:"room" } */
    if (msg.join) {
      joinedRoom = msg.join;
      if (!rooms.has(joinedRoom)) rooms.set(joinedRoom, []);
      rooms.get(joinedRoom).push(socket);
      return;
    }

    /* Forward everything else to the other peer in the room */
    if (joinedRoom) {
      const peers = rooms.get(joinedRoom) || [];
      const payload = JSON.stringify(msg);   // <- ALWAYS send text
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
  console.log(`Server running  →  http://localhost:${PORT}`)
);