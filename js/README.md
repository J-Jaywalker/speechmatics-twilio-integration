# Speechmatics ↔ Twilio Voice — Node.js / TypeScript Reference Integration

Bridges a Twilio Voice phone call to Speechmatics Realtime and prints
per-speaker transcripts to your local console.

> For the Python sibling, see [`../python/README.md`](../python/README.md).

This is a **reference implementation** for engineers and developers looking
to add Speechmatics transcription to a Twilio-powered voice product using
the [`@speechmatics/real-time-client`](https://www.npmjs.com/package/@speechmatics/real-time-client)
JS SDK. Both sides of the call are transcribed via Speechmatics' multi-channel
diarization, so you get a clean `Inbound` vs `Outbound` split without any
client-side audio mixing.

## What you'll build

```
┌────────┐    ┌────────┐    ┌──────────┐    ┌─────────────────────┐
│ Caller │───▶│ Twilio │───▶│ proxy.ts │───▶│ Speechmatics RT     │
└────────┘    └────────┘    └──────────┘    │ (multi-channel)     │
                                            └──────────┬──────────┘
                                                       │
                                             transcripts to console
```

- Twilio forks the live call audio to `proxy.ts` over WebSocket (μ-law 8 kHz).
- `proxy.ts` relays audio to Speechmatics Realtime — no transcoding needed.
- Speechmatics returns per-channel transcripts, printed to your console with
  partials overwriting in place and finals committing to new lines.

## Prerequisites

- Node.js 20 or newer
- A [Speechmatics account](https://portal.speechmatics.com/) and API key
- A [Twilio account](https://www.twilio.com/) with a voice-capable phone number
- An [ngrok](https://ngrok.com/) account and auth token (used to expose your
  local server to Twilio)

## Setup

```bash
# 1. Clone and enter the js/ folder
git clone <this-repo>
cd speechmatics-twilio-integration/js

# 2. Install dependencies
npm install

# 3. Copy the env template at the repo root and fill in your keys.
#    (Both the Python and Node implementations read from ../.env.)
cp ../.env.example ../.env
$EDITOR ../.env
```

## Run

```bash
npm start
```

On startup `proxy.ts` will:

1. Open an ngrok tunnel.
2. Serve a `/twiml` endpoint on that tunnel that returns the required
   `<Start><Stream>` + short greeting + `<Dial>` to `FORWARD_TO_NUMBER`.
3. Update your Twilio number's Voice URL to point at that `/twiml`.

Dial the Twilio number from any phone; `FORWARD_TO_NUMBER` rings; answer
it, and the two-party conversation is transcribed live to the console.

The Voice URL stays pointed at the last ngrok tunnel after Ctrl-C — the
next `npm start` overwrites it with the fresh URL. If you need Twilio to
route calls elsewhere while the proxy isn't running, set that in the Twilio
Console.

## What you should see

```
[twilio] incoming Media Streams connection
[twilio] protocol handshake ok
[twilio] call started - stream=MZxxx... call=CAxxx... tracks=["inbound","outbound"]
[inbound ] Hello there. How are you doing today?
[outbound] I'm doing pretty well thanks.
[twilio] call stopped (stream=MZxxx...)
```

- **inbound** = the person who called the Twilio number.
- **outbound** = the person the Twilio number bridged to via `<Dial>`.

## Key design choices

- **Multi-channel diarization**, not two separate sessions. One
  `MultiChannelRealtimeClient` handles both tracks over a single WebSocket
  and tags each transcript with its channel label.
- **`MultiChannelRealtimeClient`** is a thin subclass of the SDK's
  `RealtimeClient` that exposes `sendChannelAudio(channel, base64)` and
  `endChannel(...)` — the underlying `AddChannelAudio` / `EndOfChannel`
  wire messages are supported by the SDK types but not yet by a public
  method. The subclass is <10 lines.
- **Base64 pass-through, zero decoding.** Twilio's `media.payload` is
  already base64; that's exactly the shape `AddChannelAudio.data` wants,
  so frames go straight through with no CPU work.
- **μ-law forwarded natively**, no transcoding. Twilio ships μ-law 8 kHz;
  Speechmatics accepts μ-law 8 kHz. One less pipeline stage.

## Development / running the tests

The `tests/` folder contains a Vitest suite covering the pieces of
`proxy.ts` that map to the integration requirements — session routing,
TwiML generation, and Twilio Media Streams event handling. It uses a fake
WebSocket and spies on `CallSession`, so no live services (Twilio,
Speechmatics, ngrok) are contacted.

```bash
npm test           # single run
npm run test:watch # re-run on file changes
npm run typecheck  # tsc --noEmit
```

Layout:

```
tests/
├── call-session.test.ts     # frame routing, wire-format constants, close cascade
├── handler.test.ts          # handleTwilioCall end-to-end (mocked)
└── twiml.test.ts            # <Response> / <Start> / <Stream> shape
```

Use this suite as scaffolding when adapting the integration for your own
setup — swap in your own handler code, then re-run `npm test` to confirm
you haven't broken the contract with Twilio or Speechmatics.

## Production considerations

This is a demo. Before shipping to production:

- Replace the raw `node:http` + `ws` server with a proper framework
  (Fastify, Hono, Express) behind a reverse proxy.
- Move credentials from `.env` to a real secret manager.
- Add auth on the `/twilio` endpoint (Twilio can sign requests — verify
  the signature).
- Add structured logging and metrics rather than `console.log`.
- Consider what "the call is over" means — Twilio's `stop` event is
  reliable, but the WebSocket may also just drop.

## Troubleshooting

- **`Missing required env vars in .env: ...`** — copy `../.env.example`
  to `../.env` at the repo root and fill in the listed values.
- **`Twilio number ... not found on this account`** — check that
  `TWILIO_PHONE_NUMBER` is in E.164 form and belongs to the account whose
  SID/token you provided.
