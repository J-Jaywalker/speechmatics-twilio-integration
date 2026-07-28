# Node.js tests

Vitest suite covering the pieces of `../proxy.ts` that map to the
integration requirements — session routing, TwiML generation, and Twilio
Media Streams event handling. It uses a fake WebSocket and spies on
`CallSession`, so no live services (Twilio, Speechmatics, ngrok) are
contacted while the tests run.

## Run

From the `js/` folder:

```bash
npm install
npm test           # single run
npm run test:watch # re-run on file changes
npm run typecheck  # tsc --noEmit
```

## Layout

```
tests/
├── call-session.test.ts     # frame routing, wire-format constants, close cascade
├── handler.test.ts          # handleTwilioCall end-to-end (mocked)
└── twiml.test.ts            # <Response> / <Start> / <Stream> shape
```

Each test file starts with a `Feature:` block describing the area it
covers; each test carries a Gherkin-style `Scenario:` docstring plus a
`Purpose:` line explaining why it exists and what it protects against.

## Adapting for your own integration

Use this suite as scaffolding — swap in your own handler code inside
`proxy.ts`, then re-run `npm test` to confirm you haven't broken the
contract with Twilio or Speechmatics.
