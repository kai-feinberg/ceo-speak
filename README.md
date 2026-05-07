# Text Intelligence Extension

A Chrome MV3 prototype for Grammarly-style suggestions in plain textareas.

## Stack

- PNPM workspace
- Vite Plugin Web Extension for the Chrome extension
- React content UI mounted in a Shadow DOM host
- Local Vite demo page with a plain textarea
- Local Node/Express API that calls OpenRouter with structured JSON output
- Shared TypeScript/Zod contracts in `packages/shared`

## Local Setup

Create `apps/api/.env`:

```env
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=openai/gpt-4o-mini
PORT=8787
```

Install dependencies:

```sh
pnpm install
```

Run everything:

```sh
pnpm --filter @text-intel/api dev
pnpm --filter @text-intel/demo dev
pnpm --filter @text-intel/extension dev
```

Expected local URLs:

- API: `http://127.0.0.1:8787`
- Demo: `http://127.0.0.1:5173`
- Extension dev server: `http://127.0.0.1:5174`

Load `apps/extension/dist` as an unpacked extension in Chrome, then open the demo page and focus the textarea.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

Quick API check:

```sh
curl -sS -X POST http://127.0.0.1:8787/api/analyze \
  -H 'Content-Type: application/json' \
  --data '{"fullTextLength":26,"windowText":"This sentnce has teh issue.","windowStart":0,"cursorOffset":10}'
```
