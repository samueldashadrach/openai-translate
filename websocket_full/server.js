// server.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

/* ───────────────────────── static files ─────────────────────────── */
const app    = express();
const server = http.createServer(app);
app.use(express.static('public'));

/* ───────────────────────── OpenAI sockets ───────────────────────── */
const OPENAI_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
const HEADERS = {
  'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  'OpenAI-Beta' :  'realtime=v1'
};

function openAiSession(name, prompt) {
  const ws = new WebSocket(OPENAI_URL, { headers: HEADERS });

  ws.on('open', () => {
    console.log(`[${name}] OpenAI websocket ready`);
    ws.send(JSON.stringify({ type:'system_message.create', content: prompt }));
  });

  ws.on('error', err => console.error(`[${name}]`, err));
  ws.on('close',     () => console.warn(`[${name}] closed`));
  return ws;
}

const A2B = openAiSession(
  'A2B',
  'You are a real-time interpreter. Input language: English. Output language: Spanish. Respond ONLY with translated speech and text.'
);

const B2A = openAiSession(
  'B2A',
  'You are a real-time interpreter. Input language: Spanish. Output language: English. Respond ONLY with translated speech and text.'
);

/* ────────────────────── browsers ⇄ relay websocket ──────────────── */
const clientWss = new WebSocketServer({ server });
let aliceSocket;
let bobSocket;

clientWss.on('connection', socket => {
  let role;                                              // "alice" | "bob"

  socket.on('message', (data, isBinary) => {
    /* first text frame declares the role */
    if (!role && !isBinary) {
      const { role: r } = JSON.parse(data.toString());
      role = r;
      if (role === 'alice') aliceSocket = socket;
      if (role === 'bob')   bobSocket   = socket;
      console.log(`${role} connected`);
      return;
    }

    /* binary frames = microphone PCM16 */
    if (isBinary) {
      forwardAudioFromClient(role, data);
      return;
    }

    /* control {"type":"stop"} marks end of utterance */
    const msg = JSON.parse(data.toString());
    if (msg.type === 'stop') flushUtterance(role);
  });

  socket.on('close', () => {
    if (role === 'alice') aliceSocket = undefined;
    if (role === 'bob')   bobSocket   = undefined;
    console.log(`${role ?? 'unknown'} disconnected`);
  });
});

/* ───────────────────────── helpers ──────────────────────────────── */
function forwardAudioFromClient(role, buffer) {
  const target = role === 'alice' ? A2B : B2A;
  target.send(JSON.stringify({
    type : 'input_audio_buffer.append',
    audio: buffer.toString('base64')
  }));
}

function flushUtterance(role) {
  const target = role === 'alice' ? A2B : B2A;
  target.send(JSON.stringify({ type:'input_audio_buffer.commit' }));
  target.send(JSON.stringify({ type:'response.create' }));
  target.send(JSON.stringify({ type:'input_audio_buffer.clear' }));
}

function wire(aiWs, otherSock) {
  aiWs.on('message', raw => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'output_audio_chunk') {
      const sock = otherSock();
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(Buffer.from(msg.audio, 'base64'), { binary:true });
    }

    if (msg.type === 'assistant_response_chunk') {
      const sock = otherSock();
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(JSON.stringify({ caption: msg.text }));
    }
  });
}

wire(A2B, () => bobSocket);
wire(B2A, () => aliceSocket);

/* ───────────────────────── start HTTP server ────────────────────── */
server.listen(3000, () => console.log('http://localhost:3000'));