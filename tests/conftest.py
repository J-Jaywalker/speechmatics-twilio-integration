"""
Shared pytest fixtures and helpers for the proxy test suite.

The tests here never contact Twilio, ngrok, or Speechmatics. Instead:

  - `fake_ws` builds an async-iterable object that yields JSON-encoded
    Twilio Media Streams events, exactly the way the real
    `websockets` server would deliver them to `handle_twilio_call`.

  - `media_event` / `start_event` produce well-formed Twilio event
    dicts so tests don't repeat boilerplate.

Keep all shared test data here so individual test files stay focused
on the behaviour they're proving.
"""

import base64
import json
from typing import Iterable

import pytest


@pytest.fixture
def fake_ws():
    """
    Factory fixture: build an async-iterable WebSocket stand-in.

    Usage:
        ws = fake_ws([{"event": "connected"}, {"event": "stop"}])
        await handle_twilio_call(ws)

    Each dict is JSON-encoded and yielded in order, mimicking exactly
    how `websockets` delivers text frames from a live client.
    """

    class _FakeWS:
        def __init__(self, messages: Iterable[dict]) -> None:
            # Pre-serialise so the async iterator can just yield strings
            # (no per-iteration allocation).
            self._messages = [json.dumps(m) for m in messages]

        def __aiter__(self):
            # `async for raw in ws:` calls this; we return an async
            # generator that walks our pre-computed list.
            return self._async_iter()

        async def _async_iter(self):
            for msg in self._messages:
                yield msg

    return _FakeWS


@pytest.fixture
def media_event():
    """
    Factory fixture: build a well-formed Twilio 'media' event dict.

    Usage:
        event = media_event("inbound", b"\\x01\\x02\\x03")

    The `payload` field is base64-encoded exactly like Twilio does on
    the wire, so the handler under test exercises the real decode path.
    """

    def _build(track: str = "inbound", payload_bytes: bytes = b"\x01\x02\x03"):
        return {
            "event": "media",
            "media": {
                "track": track,
                # Base64-encode + decode-to-str: matches Twilio's wire
                # format where payload is a JSON string.
                "payload": base64.b64encode(payload_bytes).decode(),
            },
        }

    return _build


@pytest.fixture
def start_event():
    """
    Canned Twilio 'start' event dict.

    The SIDs and track list are fixed - they're inspected as strings
    by the handler for logging only, so any well-formed values work.
    """
    return {
        "event": "start",
        "start": {
            "streamSid": "MZ0000000000000000000000000000",
            "callSid": "CA0000000000000000000000000000",
            "tracks": ["inbound", "outbound"],
        },
    }
