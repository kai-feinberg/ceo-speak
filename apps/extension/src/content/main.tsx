import "./styles.css";
import { createRoot, type Root } from "react-dom/client";
import {
  AnalyzeResponseSchema,
  extractFocusedWindow,
  type CorporateLevel,
  type Suggestion
} from "@text-intel/shared";
import { App } from "./App";
import {
  createTextSurface,
  findEditableFromEventTarget,
  findGmailComposeBodies,
  findInitiallyFocusedEditable,
  type TextSurface
} from "./textSurface";

type OverlayState = {
  activeSuggestion: Suggestion | null;
  position: { top: number; left: number } | null;
  isAnalyzing: boolean;
  level: CorporateLevel;
  apiKeyDraft: string;
  hasApiKey: boolean;
  apiKeyMessage: string | null;
  isSettingsOpen: boolean;
};

const apiUrl = "http://127.0.0.1:8787/api/analyze";
const levelStorageKey = "text-intelligence-corporate-level";
const apiKeyStorageKey = "text-intelligence-openrouter-key";
const cacheStorageKey = "text-intelligence-suggestion-cache";
const debounceMs = 700;
let activeTextarea: HTMLTextAreaElement | null = null;
let activeSurface: TextSurface | null = null;
let openRouterApiKey: string | null = null;
let suggestions: Suggestion[] = [];
let dismissedIds = new Set<string>();
let appliedIds = new Set<string>();
let analyzeTimer = 0;
let requestId = 0;
let reactRoot: Root | null = null;
let shadowHost: HTMLElement | null = null;
let mirror: HTMLElement | null = null;
let markerLayer: HTMLElement | null = null;
const observedGmailBodies = new WeakSet<HTMLElement>();
let overlayState: OverlayState = {
  activeSuggestion: null,
  position: null,
  isAnalyzing: false,
  level: "manager",
  apiKeyDraft: "",
  hasApiKey: false,
  apiKeyMessage: null,
  isSettingsOpen: false
};

void init();

async function init() {
  const settings = await readSettings();
  openRouterApiKey = settings.openRouterApiKey;
  overlayState = {
    ...overlayState,
    level: settings.level,
    hasApiKey: Boolean(settings.openRouterApiKey)
  };

  document.addEventListener("focusin", (event) => {
    const editable = findEditableFromEventTarget(event.target);
    if (editable) attachToEditable(editable);
  });

  const focused = findInitiallyFocusedEditable();
  if (focused) {
    attachToEditable(focused);
  }

  watchForGmailComposeBodies();
}

function attachToEditable(element: HTMLElement) {
  if (activeSurface?.element === element) return;
  const surface = createTextSurface(element);
  if (!surface) return;

  detachSurfaceListeners();
  activeSurface = surface;
  activeTextarea = element instanceof HTMLTextAreaElement ? element : null;
  suggestions = readCachedSuggestions(surface.getText());
  dismissedIds = new Set();
  appliedIds = new Set();
  ensureUi();
  ensureMirror();
  surface.element.addEventListener("input", onInput);
  surface.element.addEventListener("scroll", renderMarkers);
  surface.element.addEventListener("click", renderMarkers);
  surface.element.addEventListener("keyup", renderMarkers);
  window.addEventListener("resize", renderMarkers);
  renderMarkers();
  queueAnalyze();
}

function detachSurfaceListeners() {
  if (!activeSurface) return;
  activeSurface.element.removeEventListener("input", onInput);
  activeSurface.element.removeEventListener("scroll", renderMarkers);
  activeSurface.element.removeEventListener("click", renderMarkers);
  activeSurface.element.removeEventListener("keyup", renderMarkers);
  window.removeEventListener("resize", renderMarkers);
}

function watchForGmailComposeBodies() {
  if (!location.hostname.endsWith("mail.google.com")) return;

  for (const body of findGmailComposeBodies()) {
    observeGmailBody(body);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        for (const body of findGmailComposeBodies(node)) {
          observeGmailBody(body);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function observeGmailBody(body: HTMLElement) {
  if (observedGmailBodies.has(body)) return;
  observedGmailBodies.add(body);
  body.addEventListener("focus", () => attachToEditable(body), { once: true });
}

function ensureUi() {
  if (shadowHost) return;
  shadowHost = document.createElement("text-intelligence-ui");
  document.documentElement.append(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .ti-toolbar {
      position: fixed;
      right: 18px;
      top: 18px;
      z-index: 2147483647;
      border: 1px solid rgb(255 255 255 / 45%);
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgb(255 255 255 / 94%), rgb(255 246 214 / 95%)),
        #fff;
      color: #171717;
      padding: 10px;
      font: 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 18px 40px rgb(101 64 12 / 22%);
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 9px;
      width: 372px;
      max-width: calc(100vw - 36px);
      min-height: 102px;
    }
    .ti-toolbar__row {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .ti-brand {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 138px;
    }
    .ti-brand__mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 6px;
      background: #111827;
      font: 900 16px/1 ui-sans-serif, system-ui, sans-serif;
    }
    .ti-brand__text {
      color: #171717;
      font: 900 14px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .ti-brand__cash {
      color: #16a34a;
      font: 900 11px/1 ui-sans-serif, system-ui, sans-serif;
    }
    .ti-toolbar__status {
      flex: 1;
      border: 1px solid rgb(17 24 39 / 10%);
      border-radius: 6px;
      background: #ecfdf5;
      color: #7c2d12;
      padding: 7px 8px;
      font: 900 11px/1 ui-sans-serif, system-ui, sans-serif;
      text-align: center;
      white-space: nowrap;
    }
    .ti-toolbar__status--active {
      color: #166534;
      background: #dcfce7;
      box-shadow: inset 0 -2px 0 rgb(22 101 52 / 14%);
    }
    .ti-mode-row {
      border: 1px solid rgb(124 45 18 / 14%);
      border-radius: 8px;
      background: rgb(255 255 255 / 56%);
      padding: 7px;
    }
    .ti-mode-row__label {
      color: #854d0e;
      font: 900 10px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 6px;
    }
    .ti-levels {
      display: flex;
      gap: 5px;
    }
    .ti-level {
      border: 1px solid rgb(124 45 18 / 14%);
      border-radius: 6px;
      background: #fffaf0;
      color: #713f12;
      padding: 9px 8px;
      font: 900 12px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: capitalize;
      cursor: pointer;
      flex: 1;
    }
    .ti-level--active {
      background: #16a34a;
      border-color: #15803d;
      color: #f0fdf4;
      box-shadow: 0 8px 16px rgb(22 163 74 / 24%);
    }
    .ti-icon-button,
    .ti-close-button {
      border: 0;
      border-radius: 6px;
      width: 30px;
      height: 30px;
      background: #111827;
      color: #fff;
      font: 900 13px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .ti-icon-button--active {
      background: #16a34a;
    }
    .ti-settings {
      position: fixed;
      right: 18px;
      top: 138px;
      z-index: 2147483647;
      width: 372px;
      max-width: calc(100vw - 36px);
      border: 1px solid rgb(17 24 39 / 14%);
      border-radius: 8px;
      background: #fffaf0;
      color: #171717;
      padding: 14px;
      font: 12px/1.25 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 24px 54px rgb(101 64 12 / 24%);
    }
    .ti-settings__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .ti-settings__eyebrow {
      color: #be123c;
      font: 900 10px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 4px;
    }
    .ti-settings__title {
      font: 900 19px/1.05 ui-sans-serif, system-ui, sans-serif;
      color: #111827;
    }
    .ti-settings__actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .ti-key {
      display: block;
    }
    .ti-key__label {
      display: block;
      margin-bottom: 5px;
      color: #713f12;
      font-weight: 800;
    }
    .ti-key__input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      border: 1px solid rgb(124 45 18 / 22%);
      border-radius: 6px;
      padding: 9px 10px;
      color: #171717;
      background: #fff;
      font: 12px/1.1 ui-sans-serif, system-ui, sans-serif;
      outline: none;
    }
    .ti-key__input:focus {
      border-color: #e11d48;
      box-shadow: 0 0 0 3px rgb(225 29 72 / 16%);
    }
    .ti-key__button {
      border: 0;
      border-radius: 6px;
      min-height: 30px;
      padding: 9px 11px;
      background: #16a34a;
      color: #fff;
      font: 800 12px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .ti-key__button--quiet {
      background: #ededed;
      color: #555;
    }
    .ti-key__message {
      margin-top: 8px;
      color: #be123c;
      font: 800 11px/1.25 ui-sans-serif, system-ui, sans-serif;
    }
    .ti-popover {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483647;
      width: 260px;
      border: 1px solid rgb(22 163 74 / 28%);
      border-radius: 8px;
      background: linear-gradient(135deg, #f0fdf4, #ffffff 58%, #fefce8);
      color: #171717;
      padding: 12px;
      font: 13px/1.35 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 20px 52px rgb(22 101 52 / 22%);
      overflow: hidden;
    }
    .ti-popover::before {
      content: "$  💸  🤑  💵  $  📈  💸  $  🤑  💵  $  📈  💸  $  🤑  💵  $  📈  💸  $  🤑  💵  $  📈";
      position: absolute;
      inset: 7px 12px;
      color: rgb(22 101 52 / 11%);
      font: 900 18px/1.65 ui-sans-serif, system-ui, sans-serif;
      pointer-events: none;
      white-space: normal;
      word-spacing: 12px;
      z-index: 0;
    }
    .ti-popover__meta,
    .ti-popover__message,
    .ti-suggestion,
    .ti-dismiss {
      position: relative;
      z-index: 1;
    }
    .ti-popover__meta {
      color: #166534;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 5px;
      padding-right: 30px;
    }
    .ti-popover__message {
      color: #14532d;
      margin-bottom: 8px;
      padding-right: 18px;
    }
    .ti-suggestion,
    .ti-dismiss {
      border: 0;
      border-radius: 6px;
      min-height: 32px;
      padding: 6px 9px;
      font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .ti-suggestion {
      width: 100%;
      background: #16a34a;
      color: #f0fdf4;
      text-align: left;
      box-shadow: inset 0 -2px 0 rgb(20 83 45 / 24%);
    }
    .ti-dismiss {
      position: absolute;
      top: 8px;
      right: 8px;
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      min-height: 26px;
      padding: 0;
      background: rgb(22 101 52 / 12%);
      color: #14532d;
    }
  `;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  reactRoot = createRoot(mount);
  renderApp();
}

function ensureMirror() {
  if (mirror) return;
  mirror = document.createElement("div");
  mirror.className = "ti-textarea-mirror";
  markerLayer = document.createElement("div");
  markerLayer.className = "ti-marker-layer";
  mirror.append(markerLayer);
  document.documentElement.append(mirror);
}

function onInput() {
  if (!activeSurface) return;
  const text = activeSurface.getText();
  suggestions = keepSuggestionsMatchingText(text, suggestions);
  if (
    overlayState.activeSuggestion &&
    !suggestions.some((suggestion) => suggestion.id === overlayState.activeSuggestion?.id)
  ) {
    overlayState = { ...overlayState, activeSuggestion: null, position: null };
  }
  writeCachedSuggestions(text, suggestions);
  renderApp();
  renderMarkers();
  queueAnalyze();
}

function queueAnalyze() {
  window.clearTimeout(analyzeTimer);
  overlayState = { ...overlayState, isAnalyzing: true };
  renderApp();
  analyzeTimer = window.setTimeout(analyze, debounceMs);
}

async function analyze() {
  if (!activeSurface) return;
  const surface = activeSurface;
  const text = surface.getText();
  const currentRequestId = ++requestId;
  const request = {
    ...extractFocusedWindow(text, surface.getCursorOffset()),
    level: overlayState.level,
    ...(openRouterApiKey ? { openRouterApiKey } : {})
  };

  if (!request.windowText.trim()) {
    suggestions = [];
    writeCachedSuggestions(text, suggestions);
    overlayState = { ...overlayState, isAnalyzing: false };
    renderApp();
    renderMarkers();
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });

    if (!response.ok) throw new Error(`Analyze failed: ${response.status}`);
    const parsed = AnalyzeResponseSchema.parse(await response.json());
    if (currentRequestId !== requestId || activeSurface !== surface) return;
    suggestions = mergeSuggestions(
      surface.getText(),
      suggestions,
      parsed.suggestions.filter(
        (suggestion) => !dismissedIds.has(suggestion.id) && !appliedIds.has(suggestion.id)
      )
    );
    writeCachedSuggestions(surface.getText(), suggestions);
  } catch (error) {
    console.error(error);
  } finally {
    if (currentRequestId === requestId) {
      overlayState = { ...overlayState, isAnalyzing: false };
      renderApp();
      renderMarkers();
    }
  }
}

function renderMarkers() {
  if (!activeSurface || !mirror || !markerLayer) return;
  if (activeTextarea) {
    renderTextareaMarkers();
    return;
  }

  renderContentEditableMarkers();
}

function renderTextareaMarkers() {
  if (!activeTextarea || !mirror || !markerLayer) return;
  const rect = activeTextarea.getBoundingClientRect();
  const computed = window.getComputedStyle(activeTextarea);

  Object.assign(mirror.style, {
    position: "fixed",
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    padding: computed.padding,
    border: computed.border,
    font: computed.font,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "2147483646"
  });

  markerLayer.textContent = "";
  Object.assign(markerLayer.style, {
    position: "static",
    inset: "",
    width: "100%",
    minHeight: "100%",
    pointerEvents: ""
  });
  const text = activeTextarea.value;
  const visibleSuggestions = suggestions.filter((suggestion) => !dismissedIds.has(suggestion.id));
  const parts: Array<string | Suggestion> = [];
  let cursor = 0;

  for (const suggestion of visibleSuggestions.sort((a, b) => a.start - b.start)) {
    if (suggestion.start < cursor) continue;
    parts.push(text.slice(cursor, suggestion.start));
    parts.push(suggestion);
    cursor = suggestion.end;
  }
  parts.push(text.slice(cursor));

  const scrolled = document.createElement("div");
  scrolled.style.transform = `translate(${-activeTextarea.scrollLeft}px, ${-activeTextarea.scrollTop}px)`;
  scrolled.style.minHeight = "100%";

  for (const part of parts) {
    if (typeof part === "string") {
      scrolled.append(document.createTextNode(part));
    } else {
      const mark = document.createElement("span");
      mark.className = "ti-marker";
      mark.dataset.suggestionId = part.id;
      mark.textContent = part.original;
      mark.addEventListener("mouseenter", () => showSuggestion(part, mark));
      scrolled.append(mark);
    }
  }

  markerLayer.append(scrolled);
}

function renderContentEditableMarkers() {
  if (!activeSurface || !mirror || !markerLayer) return;
  const rect = activeSurface.element.getBoundingClientRect();

  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    padding: "0",
    border: "0",
    font: "inherit",
    lineHeight: "normal",
    letterSpacing: "normal",
    whiteSpace: "normal",
    overflowWrap: "normal",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: "2147483646"
  });

  markerLayer.textContent = "";
  Object.assign(markerLayer.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    minHeight: "100vh",
    pointerEvents: "none"
  });

  if (rect.bottom < 0 || rect.top > window.innerHeight) return;

  const visibleSuggestions = suggestions.filter((suggestion) => !dismissedIds.has(suggestion.id));
  for (const suggestion of visibleSuggestions) {
    const rects = activeSurface.getSuggestionClientRects(suggestion);
    for (const markerRect of rects) {
      const mark = document.createElement("span");
      mark.className = "ti-marker ti-marker--rect";
      mark.dataset.suggestionId = suggestion.id;
      Object.assign(mark.style, {
        position: "fixed",
        left: `${markerRect.left}px`,
        top: `${markerRect.bottom - 2}px`,
        width: `${markerRect.width}px`,
        height: "8px",
        pointerEvents: "auto"
      });
      mark.addEventListener("mouseenter", () => showSuggestionFromRect(suggestion, markerRect));
      markerLayer.append(mark);
    }
  }
}

function showSuggestion(suggestion: Suggestion, marker: HTMLElement) {
  const rect = marker.getBoundingClientRect();
  showSuggestionFromRect(suggestion, rect);
}

function showSuggestionFromRect(suggestion: Suggestion, rect: DOMRect) {
  overlayState = {
    ...overlayState,
    activeSuggestion: suggestion,
    position: {
      left: Math.min(rect.left, window.innerWidth - 260),
      top: Math.min(rect.bottom + 8, window.innerHeight - 180)
    }
  };
  renderApp();
}

function applyActiveSuggestion(suggestion: Suggestion) {
  if (!activeSurface) return;
  const currentText = activeSurface.getText();
  const delta = suggestion.replacement.length - (suggestion.end - suggestion.start);
  appliedIds.add(suggestion.id);
  suggestions = suggestions
    .filter((item) => item.id !== suggestion.id)
    .map((item) =>
      item.start >= suggestion.end
        ? { ...item, start: item.start + delta, end: item.end + delta }
        : item
  );
  overlayState = { ...overlayState, activeSuggestion: null, position: null };
  activeSurface.replaceRange(suggestion.start, suggestion.end, suggestion.replacement);
  writeCachedSuggestions(
    `${currentText.slice(0, suggestion.start)}${suggestion.replacement}${currentText.slice(suggestion.end)}`,
    suggestions
  );
  renderApp();
  renderMarkers();
  activeSurface.focus();
}

function dismissSuggestion(id: string) {
  dismissedIds.add(id);
  suggestions = suggestions.filter((suggestion) => suggestion.id !== id);
  overlayState = { ...overlayState, activeSuggestion: null, position: null };
  renderApp();
  renderMarkers();
}

function renderApp() {
  reactRoot?.render(
    <App
      state={overlayState}
      onApply={applyActiveSuggestion}
      onDismiss={dismissSuggestion}
      onLevelChange={changeLevel}
      onSettingsToggle={toggleSettings}
      onSettingsClose={closeSettings}
      onApiKeyDraftChange={changeApiKeyDraft}
      onApiKeySave={saveApiKey}
      onApiKeyClear={clearApiKey}
    />
  );
}

function toggleSettings() {
  overlayState = {
    ...overlayState,
    isSettingsOpen: !overlayState.isSettingsOpen,
    apiKeyMessage: null
  };
  renderApp();
}

function closeSettings() {
  overlayState = {
    ...overlayState,
    isSettingsOpen: false,
    apiKeyMessage: null
  };
  renderApp();
}

async function changeLevel(level: CorporateLevel) {
  if (overlayState.level === level) return;
  overlayState = {
    ...overlayState,
    level,
    activeSuggestion: null,
    position: null
  };
  await writeSetting(levelStorageKey, level);
  suggestions = [];
  dismissedIds = new Set();
  appliedIds = new Set();
  if (activeSurface) writeCachedSuggestions(activeSurface.getText(), suggestions);
  renderApp();
  renderMarkers();
  queueAnalyze();
}

function changeApiKeyDraft(value: string) {
  overlayState = {
    ...overlayState,
    apiKeyDraft: value,
    apiKeyMessage: null
  };
  renderApp();
}

async function saveApiKey() {
  const key = overlayState.apiKeyDraft.trim();
  if (!key) {
    overlayState = { ...overlayState, isSettingsOpen: true, apiKeyMessage: "Paste the magic key first, boss." };
    renderApp();
    return;
  }

  openRouterApiKey = key;
  await writeSetting(apiKeyStorageKey, key);
  overlayState = {
    ...overlayState,
    apiKeyDraft: "",
    hasApiKey: true,
    apiKeyMessage: "Key saved. The synergy cannon is loaded."
  };
  renderApp();
  queueAnalyze();
}

async function clearApiKey() {
  openRouterApiKey = null;
  await removeSetting(apiKeyStorageKey);
  overlayState = {
    ...overlayState,
    apiKeyDraft: "",
    hasApiKey: false,
    apiKeyMessage: "Key cleared. Back to locally sourced nonsense."
  };
  renderApp();
  queueAnalyze();
}

async function readSettings(): Promise<{ level: CorporateLevel; openRouterApiKey: string | null }> {
  const values = await readSetting([levelStorageKey, apiKeyStorageKey]);
  const levelValue = values[levelStorageKey];
  const keyValue = values[apiKeyStorageKey];

  return {
    level:
      levelValue === "associate" || levelValue === "manager" || levelValue === "ceo"
        ? levelValue
        : "manager",
    openRouterApiKey: typeof keyValue === "string" && keyValue.trim() ? keyValue : null
  };
}

async function readSetting(keys: string[]) {
  if (globalThis.chrome?.storage?.local) {
    return chrome.storage.local.get(keys);
  }

  return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
}

async function writeSetting(key: string, value: string) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }

  localStorage.setItem(key, value);
}

async function removeSetting(key: string) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.remove(key);
    return;
  }

  localStorage.removeItem(key);
}

function cacheKey(text: string) {
  return `${overlayState.level}:${text}`;
}

function readCachedSuggestions(text: string): Suggestion[] {
  try {
    const raw = localStorage.getItem(cacheStorageKey);
    if (!raw) return [];
    const cache = JSON.parse(raw) as Record<string, Suggestion[]>;
    return keepSuggestionsMatchingText(text, cache[cacheKey(text)] ?? []);
  } catch {
    return [];
  }
}

function writeCachedSuggestions(text: string, nextSuggestions: Suggestion[]) {
  try {
    const raw = localStorage.getItem(cacheStorageKey);
    const cache = raw ? (JSON.parse(raw) as Record<string, Suggestion[]>) : {};
    cache[cacheKey(text)] = nextSuggestions.slice(0, 12);
    const entries = Object.entries(cache).slice(-25);
    localStorage.setItem(cacheStorageKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Local storage may be unavailable on unusual pages.
  }
}

function keepSuggestionsMatchingText(text: string, source: Suggestion[]) {
  return source.filter((suggestion) => text.slice(suggestion.start, suggestion.end) === suggestion.original);
}

function mergeSuggestions(text: string, current: Suggestion[], incoming: Suggestion[]) {
  const byRange = new Map<string, Suggestion>();
  for (const suggestion of [...current, ...incoming]) {
    if (text.slice(suggestion.start, suggestion.end) !== suggestion.original) continue;
    byRange.set(`${suggestion.start}:${suggestion.end}:${suggestion.original}:${suggestion.replacement}`, suggestion);
  }
  return [...byRange.values()].sort((a, b) => a.start - b.start).slice(0, 12);
}
