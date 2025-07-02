import 'dotenv/config';
import express              from 'express';
import http                 from 'http';
import { WebSocketServer }  from 'ws';
import WebSocket            from 'ws';

/* ───────── small logging helpers ───────── */
const ts  = () => new Date().toISOString();
const log = (tag, ...m) => console.log(ts(), `[${tag}]`, ...m);

/* ───────── HTTP server + static files ───────── */
const app    = express();
const server = http.createServer(app);
app.use(express.static('public'));        // <-- serves public/client.js + html

/* ───────── where we keep browser sockets ───────── */
let aliceSock;            // English speaker
let bobSock;              // Spanish speaker

/* ───────── Realtime OpenAI connection handling ─────────
   We keep at most two persistent sockets, one per direction.
   A socket is lazily created on the *first* audio chunk and
   re-created automatically if the server closes it.           */
const SESSIONS = {};      // e.g. { A2B: WebSocket, B2A: WebSocket }

const ENDPOINT =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

const HEADERS = {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  'OpenAI-Beta': 'realtime=v1'
};

const PROMPT = {
  A2B: 'You are a real-time interpreter. Input language: English. '
       + 'Output language: Spanish. Respond ONLY with translated '
       + 'speech and text.',
  B2A: 'You are a real-time interpreter. Input language: Spanish. '
       + 'Output language: English. Respond ONLY with translated '
       + 'speech and text.'
};

/* create or return existing session */
function session(name, otherSockFn) {
  const ws = SESSIONS[name];
  if (ws?.readyState === WebSocket.OPEN) return ws;            // reuse

  const newWs = new WebSocket(ENDPOINT, { headers: HEADERS });
  SESSIONS[name] = newWs;

  newWs.on('open', () => {
    log(name, 'OPEN');
    newWs.send(JSON.stringify({
      type   : 'system_message.create',
      content: PROMPT[name]
    }));
  });

  /* ───────── incoming events from OpenAI ───────── */
  let chunk = 0;

  newWs.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return log(name, 'bad JSON'); }

    switch (msg.type) {

      case 'input_audio_buffer.committed':
        /* we purposely wait for this ACK before asking for an answer */
        log(name, 'buffer committed –> response.create');
        newWs.send(JSON.stringify({ type: 'response.create' }));
        break;

      case 'response.audio.delta': {          // streaming PCM
        const buf = Buffer.from(msg.delta, 'base64');
        const sock = otherSockFn();
        if (sock?.readyState === WebSocket.OPEN) sock.send(buf, { binary: true });
        log(name, `audio Δ#${chunk++}  ${buf.length}B`);
        break;
      }

      case 'response.text.delta': {           // caption text
        const sock = otherSockFn();
        if (sock?.readyState === WebSocket.OPEN)
          sock.send(JSON.stringify({ caption: msg.delta }));
        log(name, `text Δ  “${msg.delta}”`);
        break;
      }

      case 'response.done':                   // finished → clear buffer
        log(name, 'response.done –> clear buffer');
        newWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        break;

      case 'ping':                            // heartbeat
        break;

      default:
        log(name, 'unhandled', msg);
    }
  });

  newWs.on('close', (code, reason) => {
    log(name, 'CLOSED', code, reason.toString());
    delete SESSIONS[name];                    // make sure next audio re-opens
  });

  newWs.on('error', err => log(name, 'ERR', err.message));

  return newWs;
}

/* ───────── relay between browsers and OpenAI ───────── */
const relayWss = new WebSocketServer({ server });

relayWss.on('connection', socket => {
  let role;                                  // set by first client msg

  socket.on('message', (data, isBinary) => {

    /* 1️⃣  first text frame => who am I? */
    if (!role && !isBinary) {
      role = JSON.parse(data.toString()).role;   // "alice" | "bob"
      if (role === 'alice') aliceSock = socket;
      if (role === 'bob')   bobSock   = socket;
      return log('relay', role, 'connected');
    }

    /* 2️⃣  binary frames = microphone PCM16 @16 kHz */
    if (isBinary) {
      const dest = role === 'alice' ? 'A2B' : 'B2A';
      const ws   = session(dest, () =>
        dest === 'A2B' ? bobSock : aliceSock);

      log('relay', role, `audio ${data.length}B → ${dest}`);
      ws.send(JSON.stringify({
        type : 'input_audio_buffer.append',
        audio: Buffer.from(data).toString('base64')
      }));
      return;
    }

    /* 3️⃣  control messages  (we only use {type:"stop"} now) */
    const msg = JSON.parse(data.toString());
    if (msg.type === 'stop') {
      const dest = role === 'alice' ? 'A2B' : 'B2A';
      const ws   = session(dest, () =>
        dest === 'A2B' ? bobSock : aliceSock);

      log('flush', role,
          'input_audio_buffer.commit  &  response.create');

      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'response.create' }));        // no VAD
    }
  });

  socket.on('close', () => {
    if (role === 'alice') aliceSock = undefined;
    if (role === 'bob')   bobSock   = undefined;
    log('relay', role ?? 'unknown', 'disconnected');
  });

  socket.on('error', err => log('relay-socket', err.message));
});

/* ───────── start HTTP server ───────── */
server.listen(3000, () => console.log('http://localhost:3000'));