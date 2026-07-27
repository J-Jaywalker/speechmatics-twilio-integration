/**
 * Feature: handleTwilioCall - Twilio Media Streams event loop
 *
 * handleTwilioCall is the WebSocket handler Twilio talks to for the
 * lifetime of one call. It:
 *   - Receives JSON events ("connected", "start", "media", "stop")
 *   - Creates a CallSession on "start"
 *   - Forwards base64 payloads to the session by track label
 *   - Closes the session cleanly on shutdown or dropped socket
 *
 * The real WebSocket is replaced with a small EventEmitter-based fake,
 * and CallSession is spied on so no live services are touched.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi, afterEach } from "vitest";

import * as proxy from "../proxy.js";
const { handleTwilioCall, CallSession } = proxy;

/**
 * FakeWS emulates the ws library's WebSocket surface just enough for
 * handleTwilioCall: on("message"|"close"|"error") + close().
 */
class FakeWS extends EventEmitter {
  close(): void {
    this.emit("close");
  }
  emitEvent(event: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(event), "utf8"));
  }
}

const START_EVENT = {
  event: "start",
  start: {
    streamSid: "MZ0000000000000000000000000000",
    callSid: "CA0000000000000000000000000000",
    tracks: ["inbound", "outbound"],
  },
};

function mediaEvent(track: string, payload: string) {
  return { event: "media", media: { track, payload } };
}

/**
 * Patch CallSession.prototype so handleTwilioCall's `new CallSession()`
 * lands on our spies without needing DI plumbing in production code.
 */
function stubCallSession() {
  const spies = {
    start: vi.fn(),
    enqueue: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const startSpy = vi.spyOn(CallSession.prototype, "start").mockImplementation(spies.start);
  const enqueueSpy = vi
    .spyOn(CallSession.prototype, "enqueue")
    .mockImplementation(spies.enqueue);
  const closeSpy = vi.spyOn(CallSession.prototype, "close").mockImplementation(spies.close);
  return {
    spies,
    restore() {
      startSpy.mockRestore();
      enqueueSpy.mockRestore();
      closeSpy.mockRestore();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleTwilioCall - session lifecycle", () => {
  it("creates and starts a session on the start event", async () => {
    /**
     * Scenario: A well-formed Twilio start event
     *   Given a fake WebSocket queued with [connected, start, stop]
     *    When handleTwilioCall consumes the stream
     *    Then session.start() was invoked exactly once
     *
     * Purpose: guards the "call kicks off a Speechmatics session" step.
     * A regression here means no audio ever reaches Speechmatics.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent({ event: "connected" });
      ws.emitEvent(START_EVENT);
      ws.emitEvent({ event: "stop" });
      ws.close();

      await done;
      expect(spies.start).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("ignores media events that arrive before start", async () => {
    /**
     * Scenario: A "media" event arrives before "start"
     *   Given a fake WebSocket queued with [media, stop]
     *    When handleTwilioCall consumes the stream
     *    Then session.enqueue was never called
     *
     * Purpose: defensive - a broken client or reordered network could
     * deliver media first. We must not crash on a null session.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent(mediaEvent("inbound", "AAA="));
      ws.emitEvent({ event: "stop" });
      ws.close();

      await done;
      expect(spies.enqueue).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("handleTwilioCall - audio forwarding", () => {
  it("passes each media payload through to session.enqueue with its track", async () => {
    /**
     * Scenario: Interleaved inbound + outbound media events
     *   Given start -> media(inbound) -> media(outbound) -> stop
     *    When handleTwilioCall consumes the stream
     *    Then enqueue was called with ("inbound", "IN_PAYLOAD")
     *     And enqueue was called with ("outbound", "OUT_PAYLOAD")
     *
     * Purpose: multi-channel diarization contract - each track must be
     * routed with its own label. Crossed wires smush both speakers onto
     * one channel.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent(START_EVENT);
      ws.emitEvent(mediaEvent("inbound", "IN_PAYLOAD"));
      ws.emitEvent(mediaEvent("outbound", "OUT_PAYLOAD"));
      ws.emitEvent({ event: "stop" });
      ws.close();

      await done;
      const calls = spies.enqueue.mock.calls;
      expect(calls).toContainEqual(["inbound", "IN_PAYLOAD"]);
      expect(calls).toContainEqual(["outbound", "OUT_PAYLOAD"]);
    } finally {
      restore();
    }
  });

  it("passes the base64 payload straight through (no decode)", async () => {
    /**
     * Scenario: A media event's payload is base64 text
     *   Given start -> media(inbound, "TWFrZQ==") -> stop
     *    When handleTwilioCall consumes the stream
     *    Then enqueue is called with ("inbound", "TWFrZQ==") verbatim
     *
     * Purpose: The JS RT SDK's AddChannelAudio.data field expects base64,
     * exactly the shape Twilio ships. This test guards against anyone
     * accidentally decoding-then-re-encoding, which would waste CPU and
     * risk corruption on non-utf8 boundaries.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent(START_EVENT);
      ws.emitEvent(mediaEvent("inbound", "TWFrZQ=="));
      ws.emitEvent({ event: "stop" });
      ws.close();

      await done;
      expect(spies.enqueue).toHaveBeenCalledWith("inbound", "TWFrZQ==");
    } finally {
      restore();
    }
  });

  it("skips media events with no payload", async () => {
    /**
     * Scenario: A media event missing the payload key
     *   Given start -> {media without payload} -> stop
     *    When handleTwilioCall consumes the stream
     *    Then session.enqueue was never called
     *
     * Purpose: defensive - a garbled event should be dropped, not
     * crash the handler.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent(START_EVENT);
      ws.emitEvent({ event: "media", media: { track: "inbound" } });
      ws.emitEvent({ event: "stop" });
      ws.close();

      await done;
      expect(spies.enqueue).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("handleTwilioCall - graceful shutdown", () => {
  it("closes the session when Twilio sends 'stop'", async () => {
    /**
     * Scenario: The call ends via Twilio's "stop" event
     *   Given an active call (start received, media exchanged)
     *    When a "stop" event is delivered
     *    Then session.close() is awaited exactly once
     *
     * Purpose: primary graceful-shutdown path. Without this, every call
     * leaks a hung Speechmatics session.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent(START_EVENT);
      ws.emitEvent({ event: "stop" });
      ws.close();

      await done;
      expect(spies.close).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("closes the session on socket drop even without a stop event", async () => {
    /**
     * Scenario: The WebSocket drops abruptly mid-call
     *   Given an active call
     *    When the socket emits "close" without a preceding "stop"
     *    Then session.close() is still awaited exactly once
     *
     * Purpose: networks are unreliable - the `close` event listener is
     * the safety net.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent(START_EVENT);
      ws.close();

      await done;
      expect(spies.close).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("does nothing when the socket closes before start", async () => {
    /**
     * Scenario: The socket opens and closes with no "start" event
     *   Given a WebSocket that only emits "connected"
     *    When it closes
     *    Then session.close() was never called (session is null)
     *
     * Purpose: Twilio can open sockets for health checks that never
     * progress. Awaiting a nonexistent session would crash.
     */
    const { spies, restore } = stubCallSession();
    try {
      const ws = new FakeWS();
      const done = handleTwilioCall(ws as unknown as import("ws").WebSocket);

      ws.emitEvent({ event: "connected" });
      ws.close();

      await done;
      expect(spies.close).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
