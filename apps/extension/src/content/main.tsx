import "./styles.css";
import { createRoot, type Root } from "react-dom/client";
import {
  AnalyzeResponseSchema,
  applySuggestion,
  extractFocusedWindow,
  type CorporateLevel,
  type Suggestion
} from "@text-intel/shared";
import { App } from "./App";

type OverlayState = {
  activeSuggestion: Suggestion | null;
  position: { top: number; left: number } | null;
  isAnalyzing: boolean;
  level: CorporateLevel;
  apiKeyDraft: string;
  hasApiKey: boolean;
  apiKeyMessage: string | null;
};

const apiUrl = "http://127.0.0.1:8787/api/analyze";
const levelStorageKey = "text-intelligence-corporate-level";
const apiKeyStorageKey = "text-intelligence-openrouter-key";
const cacheStorageKey = "text-intelligence-suggestion-cache";
const debounceMs = 700;
let activeTextarea: HTMLTextAreaElement | null = null;
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
let overlayState: OverlayState = {
  activeSuggestion: null,
  position: null,
  isAnalyzing: false,
  level: "manager",
  apiKeyDraft: "",
  hasApiKey: false,
  apiKeyMessage: null
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
    if (event.target instanceof HTMLTextAreaElement) {
      attachToTextarea(event.target);
    }
  });

  const focused = document.activeElement;
  if (focused instanceof HTMLTextAreaElement) {
    attachToTextarea(focused);
  }
}

function attachToTextarea(textarea: HTMLTextAreaElement) {
  if (activeTextarea === textarea) return;
  detachTextareaListeners();
  activeTextarea = textarea;
  suggestions = readCachedSuggestions(textarea.value);
  dismissedIds = new Set();
  appliedIds = new Set();
  ensureUi();
  ensureMirror();
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("scroll", renderMarkers);
  textarea.addEventListener("click", renderMarkers);
  textarea.addEventListener("keyup", renderMarkers);
  window.addEventListener("resize", renderMarkers);
  renderMarkers();
  queueAnalyze();
}

function detachTextareaListeners() {
  if (!activeTextarea) return;
  activeTextarea.removeEventListener("input", onInput);
  activeTextarea.removeEventListener("scroll", renderMarkers);
  activeTextarea.removeEventListener("click", renderMarkers);
  activeTextarea.removeEventListener("keyup", renderMarkers);
  window.removeEventListener("resize", renderMarkers);
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
      border: 1px solid rgb(30 30 30 / 14%);
      border-radius: 8px;
      background: #fff;
      color: #171717;
      padding: 8px;
      font: 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 10px 28px rgb(0 0 0 / 20%);
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 7px;
      width: 360px;
      max-width: calc(100vw - 36px);
    }
    .ti-toolbar__row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ti-toolbar__label {
      color: #666;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .ti-toolbar__status {
      color: #476cdb;
      font-weight: 800;
    }
    .ti-levels {
      display: flex;
      gap: 3px;
      border: 1px solid rgb(24 24 24 / 12%);
      border-radius: 7px;
      padding: 2px;
      background: #f5f5f5;
    }
    .ti-level {
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #555;
      padding: 5px 7px;
      font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: capitalize;
      cursor: pointer;
    }
    .ti-level--active {
      background: #181818;
      color: #fff;
    }
    .ti-key {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 5px;
    }
    .ti-key__input {
      min-width: 0;
      border: 1px solid rgb(24 24 24 / 16%);
      border-radius: 6px;
      padding: 7px 8px;
      color: #171717;
      background: #fff;
      font: 12px/1 ui-sans-serif, system-ui, sans-serif;
      outline: none;
    }
    .ti-key__input:focus {
      border-color: #476cdb;
      box-shadow: 0 0 0 2px rgb(71 108 219 / 16%);
    }
    .ti-key__button {
      border: 0;
      border-radius: 6px;
      min-height: 30px;
      padding: 6px 9px;
      background: #181818;
      color: #fff;
      font: 800 12px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .ti-key__button--quiet {
      background: #ededed;
      color: #555;
    }
    .ti-key__message {
      color: #476cdb;
      font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif;
    }
    .ti-popover {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483647;
      width: 240px;
      border: 1px solid rgb(24 24 24 / 14%);
      border-radius: 8px;
      background: #fff;
      color: #171717;
      padding: 10px;
      font: 13px/1.35 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 18px 48px rgb(0 0 0 / 18%);
    }
    .ti-popover__meta {
      color: #476cdb;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
      margin-bottom: 5px;
    }
    .ti-popover__message {
      margin-bottom: 8px;
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
      background: #e9eeff;
      color: #183a9e;
      text-align: left;
      margin-bottom: 6px;
    }
    .ti-dismiss {
      background: transparent;
      color: #666;
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
  if (!activeTextarea) return;
  suggestions = keepSuggestionsMatchingText(activeTextarea.value, suggestions);
  if (
    overlayState.activeSuggestion &&
    !suggestions.some((suggestion) => suggestion.id === overlayState.activeSuggestion?.id)
  ) {
    overlayState = { ...overlayState, activeSuggestion: null, position: null };
  }
  writeCachedSuggestions(activeTextarea.value, suggestions);
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
  if (!activeTextarea) return;
  const currentRequestId = ++requestId;
  const request = {
    ...extractFocusedWindow(activeTextarea.value, activeTextarea.selectionStart),
    level: overlayState.level,
    ...(openRouterApiKey ? { openRouterApiKey } : {})
  };

  if (!request.windowText.trim()) {
    suggestions = [];
    writeCachedSuggestions(activeTextarea.value, suggestions);
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
    if (currentRequestId !== requestId) return;
    suggestions = mergeSuggestions(
      activeTextarea.value,
      suggestions,
      parsed.suggestions.filter(
        (suggestion) => !dismissedIds.has(suggestion.id) && !appliedIds.has(suggestion.id)
      )
    );
    writeCachedSuggestions(activeTextarea.value, suggestions);
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

function showSuggestion(suggestion: Suggestion, marker: HTMLElement) {
  const rect = marker.getBoundingClientRect();
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
  if (!activeTextarea) return;
  const nextValue = applySuggestion(activeTextarea.value, suggestion);
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
  activeTextarea.value = nextValue;
  const cursor = suggestion.start + suggestion.replacement.length;
  activeTextarea.setSelectionRange(cursor, cursor);
  writeCachedSuggestions(activeTextarea.value, suggestions);
  renderApp();
  renderMarkers();
  activeTextarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  activeTextarea.focus();
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
      onApiKeyDraftChange={changeApiKeyDraft}
      onApiKeySave={saveApiKey}
      onApiKeyClear={clearApiKey}
    />
  );
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
  if (activeTextarea) writeCachedSuggestions(activeTextarea.value, suggestions);
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
    overlayState = { ...overlayState, apiKeyMessage: "Paste an OpenRouter key first." };
    renderApp();
    return;
  }

  openRouterApiKey = key;
  await writeSetting(apiKeyStorageKey, key);
  overlayState = {
    ...overlayState,
    apiKeyDraft: "",
    hasApiKey: true,
    apiKeyMessage: "Key saved for this extension."
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
    apiKeyMessage: "Key cleared."
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
