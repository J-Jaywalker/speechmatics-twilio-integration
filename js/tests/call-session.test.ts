/**
 * Feature: CallSession routing + audio wire-format invariants
 *
 *   1. Audio wire format: we forward Twilio's native mulaw / 8 kHz frames
 *      straight through, no transcoding.
 *   2. Track routing: each Twilio 'media' event carries a `track` label
 *      ("inbound" or "outbound"); frames must land in the Speechmatics
 *      channel that matches that label.
 *
 * These tests don't spin up a real Speechmatics session - we stub
 * MultiChannelRealtimeClient onto the session and assert on the calls it
 * receives.
 */

import { describe, expect, it, vi } from "vitest";

import { CallSession, CHANNELS } from "../proxy.js";

describe("CHANNELS constant", () => {
  it("matches Twilio's own track labels", () => {
    /**
     * Scenario: Channel identifiers registered with Speechmatics
     *   Given the module-level CHANNELS constant
     *    When it is inspected
     *    Then it equals ["inbound", "outbound"]
     *
     * Purpose: Twilio's `media.track` field is always the bare string
     * "inbound" or "outbound". Using the same values as Speechmatics
     * channel labels means routing is a direct lookup.
     */
    expect(CHANNELS).toEqual(["inbound", "outbound"]);
  });
});

describe("CallSession.enqueue", () => {
  function withStubbedClient() {
    /**
     * Build a CallSession with its internal RT client swapped for a
     * plain spy. We poke the private fields directly - this is a test
     * harness so escaping visibility is fine.
     */
    const session = new CallSession();
    const spies = {
      sendChannelAudio: vi.fn(),
      endChannel: vi.fn(),
      stopRecognition: vi.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).client = spies;
    return { session, spies };
  }

  it("routes inbound frames to the inbound channel", () => {
    /**
     * Scenario: An inbound-track frame is routed correctly
     *   Given a CallSession with a stubbed RT client
     *    When enqueue("inbound", base64Payload) is called
     *    Then sendChannelAudio was called once with ("inbound", base64Payload)
     *
     * Purpose: routing invariant for one direction.
     */
    const { session, spies } = withStubbedClient();
    session.enqueue("inbound", "AAA=");
    expect(spies.sendChannelAudio).toHaveBeenCalledWith("inbound", "AAA=");
  });

  it("routes outbound frames to the outbound channel", () => {
    /**
     * Scenario: An outbound-track frame is routed correctly
     *   Given a CallSession with a stubbed RT client
     *    When enqueue("outbound", base64Payload) is called
     *    Then sendChannelAudio was called once with ("outbound", base64Payload)
     *
     * Purpose: mirror of the inbound test - routing must be symmetric.
     */
    const { session, spies } = withStubbedClient();
    session.enqueue("outbound", "BBB=");
    expect(spies.sendChannelAudio).toHaveBeenCalledWith("outbound", "BBB=");
  });

  it("silently drops frames with an unknown track", () => {
    /**
     * Scenario: A frame tagged with an unknown track label
     *   Given a CallSession with a stubbed RT client
     *    When enqueue("bogus", base64Payload) is called
     *    Then no exception is raised
     *     And sendChannelAudio is never called
     *
     * Purpose: defensive against malformed Twilio messages or future
     * protocol changes that add a new track name.
     */
    const { session, spies } = withStubbedClient();
    expect(() => session.enqueue("bogus", "XXX=")).not.toThrow();
    expect(spies.sendChannelAudio).not.toHaveBeenCalled();
  });
});

describe("CallSession.close", () => {
  it("sends EndOfChannel for each channel then stops recognition", async () => {
    /**
     * Scenario: Graceful close cascades to the RT client
     *   Given a CallSession with a stubbed RT client and some enqueued frames
     *    When close() is awaited
     *    Then endChannel is called once for "inbound"
     *     And endChannel is called once for "outbound"
     *     And stopRecognition is called
     *
     * Purpose: teardown must let the RT server know each channel is done
     * (via EndOfChannel with the final seq_no) so it can flush the last
     * finals before END_OF_TRANSCRIPT.
     */
    const session = new CallSession();
    const spies = {
      sendChannelAudio: vi.fn(),
      endChannel: vi.fn(),
      stopRecognition: vi.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).client = spies;

    // Simulate a couple of frames on each channel.
    session.enqueue("inbound", "A");
    session.enqueue("inbound", "B");
    session.enqueue("outbound", "C");

    // Manually resolve the EndOfTranscript promise so close() doesn't
    // wait the full 10-second fallback timeout.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).eotResolve?.();

    await session.close();

    // Both channels are told about their last seq_no.
    expect(spies.endChannel).toHaveBeenCalledWith("inbound", 2);
    expect(spies.endChannel).toHaveBeenCalledWith("outbound", 1);
    expect(spies.stopRecognition).toHaveBeenCalled();
  });

  it("is idempotent on repeated calls", async () => {
    /**
     * Scenario: close() called twice
     *   Given a CallSession that has already been closed
     *    When close() is awaited a second time
     *    Then endChannel/stopRecognition are not called again
     *
     * Purpose: teardown paths overlap (Twilio "stop" event + WebSocket
     * "close" event) - it must be safe to double-close without spurious
     * network activity or errors.
     */
    const session = new CallSession();
    const spies = {
      sendChannelAudio: vi.fn(),
      endChannel: vi.fn(),
      stopRecognition: vi.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).client = spies;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).eotResolve?.();

    await session.close();
    spies.endChannel.mockClear();
    spies.stopRecognition.mockClear();
    await session.close();

    expect(spies.endChannel).not.toHaveBeenCalled();
    expect(spies.stopRecognition).not.toHaveBeenCalled();
  });
});
