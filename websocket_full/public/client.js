// public/client.js
const connectBtn  = document.getElementById('connect');
const talkBtn     = document.getElementById('talk');
const roleSelect  = document.getElementById('role');
const captionsDiv = document.getElementById('captions');

let ws, audioCtx, processor, recording = false;

/* ───────────────── connect to relay ────────────────── */
connectBtn.onclick = () => {
  ws = new WebSocket(`ws://${location.host}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    ws.send(JSON.stringify({ role: roleSelect.value }));
    talkBtn.disabled = false;
  };

  ws.onmessage = ev => {
    if (typeof ev.data === 'string') {
      const { caption } = JSON.parse(ev.data);
      if (caption) captionsDiv.textContent = caption;
    } else {
      playPcm(ev.data);
    }
  };
};

/* ───────────────── microphone capture ──────────────── */
talkBtn.onmousedown  = startRec;
talkBtn.onmouseup    = stopRec;
talkBtn.onmouseleave = () => { if (recording) stopRec(); };

async function startRec() {
  if (recording) return;
  recording = true;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate:44100 });
    const stream  = await navigator.mediaDevices.getUserMedia({ audio:true });
    const source  = audioCtx.createMediaStreamSource(stream);
    processor     = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = e => {
      if (!recording || ws.readyState !== WebSocket.OPEN) return;
      const float441 = e.inputBuffer.getChannelData(0);
      const float16  = downsample(float441, 44100, 16000);
      const pcm16    = float32ToPCM16(float16);
      ws.send(pcm16.buffer);                     // binary frame
    };
  }
}

function stopRec() {
  recording = false;
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type:'stop' }));
}

/* ───────────────── DSP helpers ─────────────────────── */
function downsample(buf, inRate, outRate) {
  if (inRate === outRate) return buf;
  const ratio   = inRate / outRate;
  const newLen  = Math.round(buf.length / ratio);
  const out     = new Float32Array(newLen);
  let offset    = 0;
  for (let i = 0; i < newLen; i++) {
    const next = Math.round((i + 1) * ratio);
    let sum = 0, cnt = 0;
    for (; offset < next && offset < buf.length; offset++) {
      sum += buf[offset]; cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

function float32ToPCM16(floatBuf) {
  const pcm = new Int16Array(floatBuf.length);
  for (let i = 0; i < floatBuf.length; i++) {
    let s = Math.max(-1, Math.min(1, floatBuf[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm;
}

function playPcm(arrBuf) {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate:16000 });

  const pcm16  = new Int16Array(arrBuf);
  const float  = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float[i] = pcm16[i] / 0x8000;

  const buf = audioCtx.createBuffer(1, float.length, 16000);
  buf.getChannelData(0).set(float);

  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start();
}