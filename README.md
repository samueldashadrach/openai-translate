2025-07-02

# openai-translate


#### current state of project

for mac, rogue amoeba loopback jugaad works. for iphone, currently trying to code a nodejs webapp that runs on ios safari.

previous stuff
 - webrtc_call is working. connects alice and bob to each other.
 - webrtc_single is working I think? connects alice to openai realtime API.

webrtc_openai_webrtc_call is not working yet. connects alice to openai, connects alice to bob, sends alice's input to openai and openai's output to bob. (also do the same on bob's side.)

one older commit works for the first message but stops working after that

potential issues
 - handling openai webrtc events. (alice to bob call has no custom events)
 - browser autoplay issues.
 - ???

#### misc notes

rogue amoeba loopback solution does not work on iphone, only mac, figuring out alternative solution for iphone

2025-06-24T11:50 start

options for iphone
yes
 - jailbreak the phone lol. run linux on it instead of ios.
   - not tried but almost certainly works.

 - connect iphone using cable to macbook. run loopback on mac with iphone audio as input. video call runs on mac.
   - tried, works.
 - connect iphone to macbook using same wifi. run loopback on mac with iphone audio as input. video call runs on mac.
   - tried, works.

maybe
 - dont work with existing video call apps. write your iphone app that connects to openai webrtc, then pipes it to your own voice call (may or may not be webrtc)
   - do this as a webapp instead of app?


 - cable two phones together

no
 - audiobus, apematrix etc - does not work, because regular video call don't expose themselves as an endpoint for this app to hook
   - o3 says android does not support piping audio from an app to a video call app either

---

This project no longer necessary for PC.

Figured out much easier solution.

1. Open: Realtime API in safari openAI playground. Input: macOS mic
2. Open: Zoom. Input: Loopback Audio. Output: macOS speaker
3. Open: Loopback audio. Create new device. Safari 1&2 -> Channels 1&2

Do this on only one side for translation one way. Do this on both sides for translation both ways.


---

server.js works with 1 computer

for bidirectional, likely setup required

```
openai <- alice
openai -> alice -> bob

bob -> openai
alice <- bob <- openai
```

so far we have working:

```
openai <- alice
openai -> alice

bob -> openai
bob <- openai
```

now we need to do:

alice mirroring the output to bob
bob mirroring the output to alice

remember opening ports for p2p connections can be a massive pain, so there's a real possibility you need to involve the server regardless

```
option A:

openai <- alice
openai -> alice

bob -> openai
bob <- openai

alice <- bob
bob -> alice

option B:

openai <- alice
openai -> alice

bob -> openai
bob <- openai

alice <- server <- bob
bob -> server -> alice

option C:

alice -> server

server -> openai 
server <- openai

server -> bob

server <- bob

openai <- server
openai -> server

alice <- server
```

main thing missing: some library that can open 2 webrtc streams, and then pipe output of one into input of the other

ideal solution: openai supports this feature out of the box, allows sending output to a different client than the input. 




HLS does high latency low complexity, webrtc does low latency higher complexity

ffmpeg recently supports output to a webrtc stream


maybe useful:

• Janus Gateway
• Jitsi Videobridge / Jitsi Meet
• Mediasoup
• Pion (Go-based toolkit)
• LiveKit
• Kurento Media Server
• Ion-SFU
• Galene



maybe existing solutions

https://docs.livekit.io/agents/start/voice-ai/
https://github.com/livekit-examples/python-agents-examples/blob/main/realtime/openai-realtime.py
 - will require lots of effort to build even using this


https://www.twilio.com/en-us/blog/live-translation-contact-center-openai-realtime-api


---

"""
I want to build voice translate app. bob hears translation of alice. alice hears translation of bob. using openai realtime api, one limitation is that it can only respond back to the same device that opened the webrtc session with openai. hence will forward packets to implement following workflow.

(alice does not hear her own translation, and bob does not need to hear his own translation.)
"""

```
alice -> server

server -> openai 
server <- openai

server -> bob

server <- bob

openai <- server
openai -> server

alice <- server
```

o3 says
```
You only need the shim because Janus cannot ​originate​ a WebRTC PeerConnection.  
Pick a media server that ​can​ open its own PeerConnection and you can wire it
straight to the OpenAI real-time endpoint, no plain-RTP hop required.

Open-source servers that already do that:

1. mediasoup (Node/C++):  
   • createWebRtcTransport() inside the same process for the browsers  
   • create a second WebRtcTransport that dials OpenAI  
   • pipe the Producer/Consumer objects between the two transports.

2. LiveKit (Go/Rust):  
   • start an “ingress/bot participant” in the room  
   • that bot makes a WHIP/WHEP (i.e. normal WebRTC) offer to OpenAI  
   • publish the returned track back into the room.

3. ion-sfu / any Pion-based SFU (Go):  
   • Pion can create a second PeerConnection internally  
   • addTrack() the browser’s audio to that PC, send to OpenAI  
   • onTrack() from OpenAI, add it to the router and publish to the other user.

4. GStreamer with webrtcbin (C/Rust/Python):  
   • one webrtcbin element talks to Alice/Bob  
   • another webrtcbin element dials OpenAI  
   • link the pads—done.

Cloud SFUs that let you spawn server-side “media bots” (same idea, no shim):

• Twilio Voice Media Streams  
• Vonage Media Processor  
• Daily Server-Side Endpoints  

In short, use any SFU that can act as an ​active​ WebRTC endpoint (mediasoup, LiveKit, ion-sfu, GStreamer, etc.). That eliminates the RTP→WebRTC shim entirely.
```






