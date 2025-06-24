// server.js
//
// Tiny HTTP + WebSocket signalling server
// -------------------------------------------------
// 1. npm install ws
// 2. node server.js
// 3. open http://<your-ip>:3000 in two browsers
//
// Works for exactly two peers per room.
// -------------------------------------------------

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const WebSocket = require('ws');

const PORT       = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Serve index.html (and any other static files you add later)
const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
});

// WebSocket: relay all signalling messages between the two peers in a room
const wss   = new WebSocket.Server({ server });
const rooms = new Map();           // roomId -> [socketA, socketB]

wss.on('connection', socket => {
  let joinedRoom = null;

  socket.on('message', raw => {
    const message = JSON.parse(raw);

    // First message must be { join: "roomName" }
    if (message.join) {
      joinedRoom = message.join;
      if (!rooms.has(joinedRoom)) rooms.set(joinedRoom, []);
      rooms.get(joinedRoom).push(socket);
      return;
    }

    // Any subsequent messages get forwarded to the other peer
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
  console.log(`Server running → http://localhost:${PORT}`)
);