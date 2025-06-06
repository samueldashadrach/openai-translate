import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

/* ──────────────── helpers ──────────────── */
const ts  = () => new Date().toISOString();
const dbg = (tag, ...m) => console.log(ts(), `[${tag}]`, ...m);

/* ───────────── http + static ───────────── */
const app    = express();
const server = http.createServer(app);
app.use(express.static('public'));

/* ───────────── OpenAI realtime sockets ───────────── */
const OPENAI_URL =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

const HEADERS = {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  'OpenAI-Beta': 'realtime=v1'
};

function openAiSession(name, prompt) {
  const ws = new WebSocket(OPENAI_URL, { headers: HEADERS });

  ws.on('open', () => {
    dbg(name, 'OPEN');
    ws.send(
      JSON.stringify({ type: 'system_message.create', content: prompt })
    );
  });

  ws.on('error', err => dbg(name, 'ERR', err));
  ws.on('close', () => dbg(name, 'CLOSED'));
  return ws;
}

const A2B = openAiSession(
  'A2B',
  'You are a real-time interpreter. Input: English. Output: Spanish. '
  + 'Respond ONLY with translated speech and text.'
);

const B2A = openAiSession(
  'B2A',
  'You are a real-time interpreter. Input: Spanish. Output: English. '
  + 'Respond ONLY with translated speech and text.'
);

/* ───────────── browser ↔ relay socket ───────────── */
const clientWss = new WebSocketServer({ server });
let aliceSocket, bobSocket;

clientWss.on('connection', socket => {
  let role;                     // "alice" | "bob"

  socket.on('message', (data, isBinary) => {
    /* first text frame defines who this client is */
    if (!role && !isBinary) {
      role = JSON.parse(data.toString()).role;
      if (role === 'alice') aliceSocket = socket;
      if (role === 'bob')   bobSocket   = socket;
      dbg('relay', role, 'connected');
      return;
    }

    /* microphone audio from the client */
    if (isBinary) {
      dbg('relay', role, 'audio', data.length + 'B');
      forwardAudioFromClient(role, data);
      return;
    }

    /* control messages (e.g. {"type":"stop"}) */
    const msg = JSON.parse(data.toString());
    dbg('relay', role, msg);
    if (msg.type === 'stop') flushUtterance(role);
  });

  socket.on('close', () => {
    if (role === 'alice') aliceSocket = undefined;
    if (role === 'bob')   bobSocket   = undefined;
    dbg('relay', role ?? 'unknown', 'disconnected');
  });

  socket.on('error', err => dbg('relay-socket', role ?? 'unknown', err));
});

/* ──────────────── helpers ──────────────── */
function forwardAudioFromClient(role, buffer) {
  const target = role === 'alice' ? A2B : B2A;
  dbg('forward', `${role} → ${target === A2B ? 'A2B' : 'B2A'}`, buffer.length + 'B');
  target.send(
    JSON.stringify({
      type:  'input_audio_buffer.append',
      audio: buffer.toString('base64')
    })
  );
}

/* Fix: do NOT clear the buffer here – commit + create is enough */
function flushUtterance(role) {
  const target = role === 'alice' ? A2B : B2A;
  ['input_audio_buffer.commit', 'response.create'].forEach(t => {
    dbg('flush', role, t);
    target.send(JSON.stringify({ type: t }));
  });
}

/* OpenAI → other browser */
function wire(aiWs, aiName, otherSock, otherName) {
  let chunk = 0;

  aiWs.on('message', raw => {
    const msg = JSON.parse(raw.toString());

    /* audio stream from OpenAI */
    if (msg.type === 'output_audio_chunk') {
      dbg(aiName, `audio-chunk #${chunk++} len=${msg.audio.length}`);
      const sock = otherSock();
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(Buffer.from(msg.audio, 'base64'), { binary: true });
    }

    /* caption text stream */
    if (msg.type === 'assistant_response_chunk') {
      dbg(aiName, `text: "${msg.text}"`);
      const sock = otherSock();
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(JSON.stringify({ caption: msg.text }));

      /* optional: clear the buffer when the answer is finished */
      if (msg.final) {                // ← field name may differ; adapt if needed
        dbg(aiName, 'assistant finished → clear buffer');
        aiWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      }
    }
  });

  aiWs.on('error', err => dbg(aiName, 'ERR', err));
  aiWs.on('close', () => dbg(aiName, 'CLOSED'));
}

wire(A2B, 'A2B', () => bobSocket,   'bob');
wire(B2A, 'B2A', () => aliceSocket, 'alice');

/* ───────────── start server ───────────── */
server.listen(3000, () => console.log('http://localhost:3000'));