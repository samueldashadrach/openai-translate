// server.js
//
// 1. npm install ws
// 2. node server.js
//
// ────────────────────────────────────────────────
//  • Listens on http://localhost:3000
//  • Static files  →  GET /…
//  • WebSocket     →  WS /ws           (nginx will proxy-pass that)
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
    const msg = JSON.parse(raw);

    // First message must be { join: "roomName" }
    if (msg.join) {
      joinedRoom = msg.join;
      if (!rooms.has(joinedRoom)) rooms.set(joinedRoom, []);
      rooms.get(joinedRoom).push(socket);
      return;
    }

    // Forward everything else to the other peer in the room
    if (joinedRoom) {
      const peers = rooms.get(joinedRoom) || [];
      peers.forEach(peer => {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) {
          peer.send(raw);
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