2025-06-05

# openai-translate


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