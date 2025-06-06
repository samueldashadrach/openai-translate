import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

/* ───────────── helpers ───────────── */
const ts  = () => new Date().toISOString();
const dbg = (tag, ...m) => console.log(ts(), `[${tag}]`, ...m);

/* ───────────── HTTP server ───────────── */
const app    = express();
const server = http.createServer(app);
app.use(express.static('public'));

/* ───────────── OpenAI realtime wiring ───────────── */
const OPENAI_URL =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

const HEADERS = {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  'OpenAI-Beta': 'realtime=v1'
};

/* Create / recreate a realtime session and wire it up */
function connectAi(name, prompt, getOtherSock, otherName) {
  const ws = new WebSocket(OPENAI_URL, { headers: HEADERS });

  ws.on('open', () => {
    dbg(name, 'OPEN');

    /* 1. tell the server what audio we will send / expect back */
    ws.send(
      JSON.stringify({
        type: 'audio_config.set',
        audio_format: { type: 'linear16', sample_rate: 16000, channels: 1 }
      })
    );
    ws.send(
      JSON.stringify({
        type: 'response_format.set',
        response_format: { type: 'pcm', sample_rate: 16000 }
      })
    );

    /* 2. system prompt */
    ws.send(
      JSON.stringify({ type: 'system_message.create', content: prompt })
    );
  });

  /* ------------------------------------------------------------------ */
  let chunk = 0;

  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'output_audio_chunk') {
      dbg(name, `audio-chunk #${chunk++} len=${msg.audio.length}`);
      const sock = getOtherSock();
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(Buffer.from(msg.audio, 'base64'), { binary: true });
      return;
    }

    if (msg.type === 'assistant_response_chunk') {
      dbg(name, `text: "${msg.text}"`);
      const sock = getOtherSock();
      if (sock?.readyState === WebSocket.OPEN)
        sock.send(JSON.stringify({ caption: msg.text }));
      return;
    }

    /* Any other server messages – just log them so we see errors. */
    if (msg.type !== 'ping') dbg(name, 'unhandled', msg);
  });

  ws.on('close', (code, reason) => {
    dbg(name, 'CLOSED', code, reason.toString());
    /* Re-establish the session after 1 s so the relay keeps working. */
    setTimeout(
      () => (sessions[name] = connectAi(name, prompt, getOtherSock, otherName)),
      1000
    );
  });

  ws.on('error', err => dbg(name, 'ERR', err.message));

  return ws;
}

/* ───────────── browser ↔ relay socket ───────────── */
const clientWss = new WebSocketServer({ server });
let aliceSocket, bobSocket;

clientWss.on('connection', socket => {
  let role; // "alice" | "bob"

  socket.on('message', (data, isBinary) => {
    /* first text frame announces the role */
    if (!role && !isBinary) {
      role = JSON.parse(data.toString()).role;
      if (role === 'alice') aliceSocket = socket;
      if (role === 'bob')   bobSocket   = socket;
      dbg('relay', role, 'connected');
      return;
    }

    /* microphone frames arrive as binary */
    if (isBinary) {
      forwardAudio(role, data);
      return;
    }

    /* control messages  (currently only {"type":"stop"}) */
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

/* ───────────── helper functions ───────────── */
function forwardAudio(role, buf) {
  const target = sessions[role === 'alice' ? 'A2B' : 'B2A'];
  if (target?.readyState === WebSocket.OPEN) {
    dbg('forward',
        `${role} → ${target === sessions.A2B ? 'A2B' : 'B2A'}`,
        buf.length + 'B');
    target.send(
      JSON.stringify({
        type:  'input_audio_buffer.append',
        audio: buf.toString('base64')
      })
    );
  }
}

/* At end of utterance: commit + ask for answer (no clear yet) */
function flushUtterance(role) {
  const target = sessions[role === 'alice' ? 'A2B' : 'B2A'];
  if (target?.readyState !== WebSocket.OPEN) return;

  ['input_audio_buffer.commit', 'response.create'].forEach(t => {
    dbg('flush', role, t);
    target.send(JSON.stringify({ type: t }));
  });
}

/* ───────────── kick everything off ───────────── */
const sessions = {};         // mutable so reconnect can overwrite entries

sessions.A2B = connectAi(
  'A2B',
  'You are a real-time interpreter. Input: English. Output: Spanish. '
    + 'Respond only with translated speech and text.',
  () => bobSocket,
  'bob'
);

sessions.B2A = connectAi(
  'B2A',
  'You are a real-time interpreter. Input: Spanish. Output: English. '
    + 'Respond only with translated speech and text.',
  () => aliceSocket,
  'alice'
);

/* ───────────── start HTTP server ───────────── */
server.listen(3000, () => console.log('http://localhost:3000'));