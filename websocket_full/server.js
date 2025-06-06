import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

/* ─────────────── misc helpers ─────────────── */
const ts  = () => new Date().toISOString();
const dbg = (tag, ...m) => console.log(ts(), `[${tag}]`, ...m);

/* ───────────── HTTP + static files ───────────── */
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
  'You are a real-time interpreter. Input language: English. '
  + 'Output language: Spanish. Respond ONLY with translated speech and text.'
);

const B2A = openAiSession(
  'B2A',
  'You are a real-time interpreter. Input language: Spanish. '
  + 'Output language: English. Respond ONLY with translated speech and text.'
);

/* ───────────── browser ↔ relay socket ───────────── */
const clientWss = new WebSocketServer({ server });
let aliceSocket, bobSocket;

clientWss.on('connection', socket => {
  let role;                       // "alice" | "bob"

  socket.on('message', (data, isBinary) => {
    /* first text frame = role announcement */
    if (!role && !isBinary) {
      role = JSON.parse(data.toString()).role;
      if (role === 'alice') aliceSocket = socket;
      if (role === 'bob')   bobSocket   = socket;
      dbg('relay', role, 'connected');
      return;
    }

    /* audio from microphone */
    if (isBinary) {
      dbg('relay', role, 'audio', data.length + 'B');
      forwardAudio(role, data);
      return;
    }

    /* control messages: e.g. {"type":"stop"} */
    const msg = JSON.parse(data.toString());
    dbg('relay', role, msg);
    if (msg.type === 'stop') sendCommit(role);
  });

  socket.on('close', () => {
    if (role === 'alice') aliceSocket = undefined;
    if (role === 'bob')   bobSocket   = undefined;
    dbg('relay', role ?? 'unknown', 'disconnected');
  });

  socket.on('error', err => dbg('relay-socket', role ?? 'unknown', err));
});

/* ───────────── misc helpers ───────────── */
function forwardAudio(role, buffer) {
  const target = role === 'alice' ? A2B : B2A;
  dbg('forward', `${role} → ${target === A2B ? 'A2B' : 'B2A'}`,
      buffer.length + 'B');
  target.send(
    JSON.stringify({
      type:  'input_audio_buffer.append',
      audio: buffer.toString('base64')
    })
  );
}

/* Send COMMIT only; response.create will be sent after ACK arrives */
function sendCommit(role) {
  const target = role === 'alice' ? A2B : B2A;
  dbg('flush', role, 'input_audio_buffer.commit');
  target.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
}

/* Wire AI websocket ↔ other browser */
function wire(aiWs, aiName, otherSock, otherName) {
  let chunk = 0;

  aiWs.on('message', raw => {
    const msg = JSON.parse(raw.toString());

    /* 1. OpenAI confirms that the buffer is committed — now ask for answer */
    if (msg.type === 'input_audio_buffer.committed') {
      dbg(aiName, 'buffer committed → response.create');
      aiWs.send(JSON.stringify({ type: 'response.create' }));
      return;
    }

    /* 2. Streamed audio coming back from the model */
    if (msg.type === 'output_audio_chunk') {
      const sock = otherSock();
      dbg(aiName, `audio-chunk #${chunk++} len=${msg.audio.length}`);
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(Buffer.from(msg.audio, 'base64'), { binary: true });
      return;
    }

    /* 3. Streamed text coming back from the model */
    if (msg.type === 'assistant_response_chunk') {
      const sock = otherSock();
      dbg(aiName, `text: "${msg.text}"`);
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(JSON.stringify({ caption: msg.text }));

      /* when the answer is complete we can clear the buffer */
      if (msg.final) {
        dbg(aiName, 'assistant finished → input_audio_buffer.clear');
        aiWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      }
      return;
    }

    /* 4. Anything else – log for diagnostics */
    dbg(aiName, 'unhandled', msg);
  });

  aiWs.on('error', err => dbg(aiName, 'ERR', err));
  aiWs.on('close', () => dbg(aiName, 'CLOSED'));
}

wire(A2B, 'A2B', () => bobSocket,   'bob');
wire(B2A, 'B2A', () => aliceSocket, 'alice');

/* ───────────── start HTTP server ───────────── */
server.listen(3000, () => console.log('http://localhost:3000'));