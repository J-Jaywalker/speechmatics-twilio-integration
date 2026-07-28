# Python tests

Pytest suite covering the pieces of `../proxy.py` that map to the
integration requirements — audio queueing, call-session routing, TwiML
generation, and Twilio Media Streams event handling. It uses a fake
WebSocket and mocks the Speechmatics client, so no live services
(Twilio, Speechmatics, ngrok) are contacted while the tests run.

## Run

From the `python/` folder:

```bash
pip install -r requirements-dev.txt
pytest
```

## Layout

```
tests/
├── conftest.py              # fake WebSocket + canned Twilio event fixtures
├── test_audio_queue.py      # AsyncQueueSource blocking/EOF semantics
├── test_call_session.py     # frame routing, wire-format constants
├── test_handler.py          # handle_twilio_call end-to-end (mocked)
└── test_twiml.py            # <Response> / <Start> / <Stream> shape
```

Each test file starts with a `Feature:` docstring describing the area it
covers; each test carries a Gherkin-style `Scenario:` docstring plus a
`Purpose:` line explaining why it exists and what it protects against.

## Adapting for your own integration

Use this suite as scaffolding — swap in your own handler code inside
`proxy.py`, then re-run `pytest` to confirm you haven't broken the
contract with Twilio or Speechmatics.
