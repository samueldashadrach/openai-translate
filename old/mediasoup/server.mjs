// written by o3, not tested

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import mediasoup from 'mediasoup'
import { RTCPeerConnection } from 'werift-webrtc'
import OpenAI from 'openai'

/* ---------- trivial web-server & signalling ------------------ */
const app = express(); app.use(express.static('.'))
const httpServer = createServer(app).listen(3000)
const io = new Server(httpServer)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/* ---------- mediasoup boot ----------------------------------- */
const worker = await mediasoup.createWorker()
const router = await worker.createRouter({ mediaCodecs: [{
  kind:'audio', mimeType:'audio/opus', clockRate:48000, channels:1 }] })

/* ---------- minimal in-memory state -------------------------- */
const peer = { alice:{}, bob:{} }   // filled on the fly
let ready = 0                       // count mic producers we have

/* ---------- helper: tiny wrapper around OpenAI real-time ----- */
async function openAiPC(srcLang, dstLang, inProducer) {
  const pc = new RTCPeerConnection()
  // copy RTP from mediasoup to OpenAI
  const sender = pc.addTransceiver('audio').sender
  inProducer.on('rtp', p => sender.sendRtp(p))

  const offer = await pc.createOffer(); await pc.setLocalDescription(offer)

  const rsp = await openai.chat.completions.create({          //  <-- fake
    model:"gpt-4o-audio-translation",
    data:{ source_lang:srcLang, target_lang:dstLang, sdp:offer.sdp }
  })                                                          //  <-- real API
  await pc.setRemoteDescription({ type:'answer', sdp:rsp.choices[0].message.content })

  return new Promise(r => pc.ontrack = ({ track }) => r({ pc, track }))
}

/* ---------- when both mic tracks exist, wire translations ---- */
async function start() {
  /* Alice ➜ OpenAI A ➜ Bob */
  const { track: tA } = await openAiPC('en','es', peer.alice.mic)
  const pToBob = await router.createDirectTransport()
  const prodA = await pToBob.produce({ kind:'audio',
    rtpParameters:{ codecs:[{ mimeType:'audio/opus',clockRate:48000,channels:1 }],
                    encodings:[{ ssrc:1234 }] } })
  tA.onReceiveRtp.subscribe(pkt => prodA.send(pkt))

  const c = await peer.bob.transport.consume({
    producerId: prodA.id, rtpCapabilities: peer.bob.rtpCaps, paused:false })
  peer.bob.socket.emit('consume', { id:c.id, kind:c.kind, params:c.rtpParameters })

  /* Bob ➜ OpenAI B ➜ Alice */
  const { track: tB } = await openAiPC('es','en', peer.bob.mic)
  const pToAlice = await router.createDirectTransport()
  const prodB = await pToAlice.produce({ kind:'audio',
     rtpParameters:{ codecs:[{ mimeType:'audio/opus',clockRate:48000,channels:1 }],
                     encodings:[{ ssrc:5678 }] } })
  tB.onReceiveRtp.subscribe(pkt => prodB.send(pkt))

  const d = await peer.alice.transport.consume({
    producerId: prodB.id, rtpCapabilities: peer.alice.rtpCaps, paused:false })
  peer.alice.socket.emit('consume', { id:d.id, kind:d.kind, params:d.rtpParameters })
}

/* ---------- signalling API used by both browsers ------------- */
io.on('connection', socket =>{
  socket.on('join', async name =>{
    const transport = await router.createWebRtcTransport({ listenIps:['127.0.0.1'] })
    peer[name] = { socket, transport }
    socket.emit('routerRtpCaps', router.rtpCapabilities)
    socket.emit('transportCreated', transport.getTransportOptions())

    socket.on('transport-connect', dtls => transport.connect({ dtlsParameters:dtls }))
    socket.on('produce', async ({ kind, rtpParameters }) =>{
      const prod = await transport.produce({ kind, rtpParameters })
      peer[name].mic = prod; ready++
      if(ready===2) start()
    })
    socket.on('rtpCaps', caps => peer[name].rtpCaps = caps )
  })
})
console.log('open http://localhost:3000 in two tabs')