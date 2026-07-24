# Speechmatics ↔ Twilio Voice — Reference Integration

Bridges a Twilio Voice phone call to Speechmatics Realtime and prints
per-speaker transcripts to your local console.

This is a **reference implementation** for solutions engineers and developers
looking to add Speechmatics transcription to a Twilio-powered voice product.
Both sides of the call are transcribed via Speechmatics' multi-channel
diarization, so you get a clean `Inbound` vs `Outbound` split without any
client-side audio mixing.

## What you'll build

```
┌────────┐    ┌────────┐    ┌─────────┐    ┌─────────────────────┐
│ Caller │───▶│ Twilio │───▶│ proxy.py│───▶│ Speechmatics RT     │
└────────┘    └────────┘    └─────────┘    │ (multi-channel)     │
                                           └──────────┬──────────┘
                                                      │
                                            transcripts to console
```

- Twilio forks the live call audio to `proxy.py` over WebSocket (μ-law 8 kHz).
- `proxy.py` relays audio to Speechmatics Realtime — no transcoding needed.
- Speechmatics returns per-channel transcripts, printed to your console with
  partials overwriting in place and finals committing to new lines.

## Prerequisites

- Python 3.9 or newer
- A [Speechmatics account](https://portal.speechmatics.com/) and API key
- A [Twilio account](https://www.twilio.com/) with a voice-capable phone number
- An [ngrok](https://ngrok.com/) account and auth token (used to expose your
  local server to Twilio)

## Setup

```bash
# 1. Clone and enter the repo
git clone <this-repo>
cd speechmatics-twilio-integration

# 2. Create a virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Copy the env template and fill in your keys
cp .env.example .env
$EDITOR .env
```

## Run

```bash
python proxy.py
```

On startup `proxy.py` will:

1. Open an ngrok tunnel.
2. Serve a `/twiml` endpoint on that tunnel that returns the required
   `<Start><Stream>` + short greeting + `<Dial>` to `FORWARD_TO_NUMBER`.
3. Update your Twilio number's Voice URL to point at that `/twiml`.

Dial the Twilio number from any phone; `FORWARD_TO_NUMBER` rings; answer
it, and the two-party conversation is transcribed live to the console.

The Voice URL stays pointed at the last ngrok tunnel after Ctrl-C - the
next `python proxy.py` overwrites it with the fresh URL. If you need
Twilio to route calls elsewhere while the proxy isn't running, set that
in the Twilio Console.

## What you should see

```
[twilio] incoming Media Streams connection
[twilio] protocol handshake ok
[twilio] call started - stream=MZxxx... call=CAxxx... tracks=['inbound_track', 'outbound_track']
[Inbound  partial] hello there how are y
[Inbound  final  ] Hello there. How are you doing today?
[Outbound partial] i'm doing pretty w
[Outbound final  ] I'm doing pretty well thanks.
[twilio] call stopped (stream=MZxxx...)
```

- **Inbound** = the person who called the Twilio number.
- **Outbound** = the person the Twilio number bridged to via `<Dial>`.

## Key design choices

- **Multi-channel diarization**, not two separate sessions. One
  Speechmatics `AsyncMultiChannelClient` handles both tracks in a single
  WebSocket connection and tags each transcript with its channel label.
- **`chunk_size=160`** matches Twilio's native 20 ms frame size. The SDK
  reads round-robin from each source in chunks of this size, so anything
  larger just buffers audio and adds latency.
- **μ-law forwarded natively**, no transcoding. Twilio ships μ-law 8 kHz;
  Speechmatics accepts μ-law 8 kHz. One less pipeline stage.

## Production considerations

This is a demo. Before shipping to production:

- Replace the built-in `websockets.serve` with a proper ASGI runner
  (uvicorn, hypercorn) behind a reverse proxy.
- Move credentials from `.env` to a real secret manager.
- Add auth on the `/twilio` endpoint (Twilio can sign requests — verify
  the signature).
- Add structured logging and metrics rather than `print()`.
- Consider what "the call is over" means — Twilio's `stop` event is
  reliable, but the WebSocket may also just drop.

## Troubleshooting

- **`Missing required env vars in .env: ...`** — copy `.env.example` to
  `.env` and fill in the listed values.
- **`Twilio number ... not found on this account`** — check that
  `TWILIO_PHONE_NUMBER` is in E.164 form and belongs to the account whose
  SID/token you provided.
