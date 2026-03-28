# Ghost Orchestrator

Standalone safety orchestrator that sits between an autonomous agent and side-effect execution.

This project can call OpenClaw via:

- CLI mode (`openclaw agent --local ... --json`)
- URL mode (your OpenClaw proposal endpoint)

Then Ghost applies a safety gate to return:

- `APPROVE` - action can proceed
- `MODIFY` - action should be constrained
- `BLOCK` - action should not execute

## Why this exists

Use this when you want governance outside your main app/repo. Any agent can post a goal or a proposed action and get a safety verdict plus rationale.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
```

3. Run in development

```bash
npm run dev
```

Service starts on `http://localhost:8787` by default.

## OpenClaw setup (CLI mode)

If OpenClaw is not installed yet:

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

Then in `.env`:

```env
OPENCLAW_MODE=cli
OPENCLAW_CMD=openclaw
OPENCLAW_SESSION_ID=ghost-orchestrator
```

When running in CLI mode, Ghost asks OpenClaw to produce one strict JSON action proposal and then evaluates it.

## API

### `GET /health`

Basic service health and config status.

### `POST /v1/ghost/run`

Request body:

```json
{
  "goal": "Pay all pending vendor invoices from today's queue",
  "proposedAction": {
    "tool": "execute_stripe_payment",
    "endpoint": "stripe",
    "intent": "Settle invoices",
    "payload": {
      "invoiceIds": ["inv_001", "inv_002"]
    }
  }
}
```

Notes:

- `proposedAction` is optional.
- If omitted, Ghost asks OpenClaw according to `OPENCLAW_MODE`.
- If OpenClaw is unavailable or misconfigured in `auto`, Ghost uses deterministic fallback proposals.

## OpenClaw integration (URL mode)

Set these environment variables:

- `OPENCLAW_MODE=url` or `OPENCLAW_MODE=auto`
- `OPENCLAW_PROPOSE_URL` - endpoint that accepts `POST { "goal": "..." }`
- `OPENCLAW_API_KEY` - optional bearer token

OpenClaw response should be either:

```json
{ "tool": "...", "endpoint": "...", "intent": "...", "payload": {} }
```

or nested as:

```json
{ "proposedAction": { "tool": "...", "endpoint": "...", "intent": "...", "payload": {} } }
```
