# Speechmatics ↔ Twilio Voice — Reference Integration

A local proxy that bridges a Twilio Voice phone call to Speechmatics Realtime
and prints per-speaker transcripts to your console. Both sides of a bridged
two-party call are transcribed via Speechmatics' multi-channel diarization —
you get a clean `Inbound` vs `Outbound` split with no client-side audio mixing.

This repo ships two identical-behaviour implementations. Pick the one that
matches your stack and follow the README in that folder:

| Language | Folder | Start here |
|---|---|---|
| Python | [`python/`](python/) | [`python/README.md`](python/README.md) |
| Node.js / TypeScript | [`js/`](js/) | [`js/README.md`](js/README.md) |

Both implementations read the same `.env` file at this repo root, so you
configure your Speechmatics / Twilio / ngrok credentials once and can switch
between languages freely. Copy the template to get started:

```bash
cp .env.example .env
$EDITOR .env
```

## Architecture

```
┌────────┐    ┌────────┐    ┌────────────┐    ┌─────────────────────┐
│ Caller │───▶│ Twilio │───▶│ proxy.py / │───▶│ Speechmatics RT     │
└────────┘    └────────┘    │ proxy.ts   │    │ (multi-channel)     │
                            └────────────┘    └──────────┬──────────┘
                                                         │
                                              transcripts to console
```

- Twilio forks the live call audio to the proxy over WebSocket (μ-law 8 kHz).
- The proxy relays audio to Speechmatics Realtime — no transcoding.
- Speechmatics returns per-channel transcripts, printed with partials
  overwriting in place and finals committing to new lines.

The language-specific READMEs cover prerequisites, setup, `.env` variables,
what to expect at runtime, tests, and troubleshooting.
