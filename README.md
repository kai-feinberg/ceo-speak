# Text Intelligence Extension

A Chrome MV3 prototype for Grammarly-style suggestions in plain textareas. The current mode rewrites plain text into corporate/consulting jargon.

## Stack

- PNPM workspace
- Vite Plugin Web Extension for the Chrome extension
- React content UI mounted in a Shadow DOM host
- Local Vite demo page with a plain textarea
- Direct OpenRouter calls from the extension with the user-provided key
- Shared TypeScript/Zod contracts in `packages/shared`

## Corporate Levels

The injected toolbar supports three rewrite levels:

- `associate`: light professional polish
- `manager`: clear consulting/corporate phrasing
- `ceo`: aggressive executive jargon

Suggestions are debounced and cached in page `localStorage` by text and level. Existing valid underlines stay visible while fresh AI suggestions are loading.

## Local Setup

Install dependencies:

```sh
pnpm install
```

Run everything:

```sh
pnpm --filter @text-intel/demo dev
pnpm --filter @text-intel/extension dev
```

Expected local URLs:

- Demo: `http://127.0.0.1:5173`
- Extension dev server: `http://127.0.0.1:5174`

Load `apps/extension/dist` as an unpacked extension in Chrome, then open the demo page or Gmail, focus an editable text area, and save your OpenRouter key in the extension toolbar settings.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

If analysis fails in Gmail, open the extension toolbar settings and copy the latest diagnostic.
