import "./styles.css";
import { createRoot, type Root } from "react-dom/client";
import {
  AnalyzeResponseSchema,
  extractFocusedWindow,
  type AnalyzeResponse,
  type AnalyzeRequest,
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
  analysisMessage: string | null;
  diagnosticText: string | null;
  isSettingsOpen: boolean;
  isEnabled: boolean;
};

const openRouterApiUrl = "https://openrouter.ai/api/v1/chat/completions";
const openRouterModel = "openai/gpt-4o-mini";
const levelStorageKey = "text-intelligence-corporate-level";
const apiKeyStorageKey = "text-intelligence-openrouter-key";
const enabledStorageKey = "text-intelligence-enabled";
const cacheStorageKey = "text-intelligence-suggestion-cache";
const documentStyleId = "text-intelligence-document-styles";
const debounceMs = 4000;
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
  analysisMessage: null,
  diagnosticText: null,
  isSettingsOpen: false,
  isEnabled: true
};

void init();

async function init() {
  const settings = await readSettings();
  openRouterApiKey = settings.openRouterApiKey;
  overlayState = {
    ...overlayState,
    level: settings.level,
    hasApiKey: Boolean(settings.openRouterApiKey),
    isEnabled: settings.isEnabled
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
  window.addEventListener("scroll", renderMarkers, true);
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
  window.removeEventListener("scroll", renderMarkers, true);
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
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .ti-toolbar__status--active {
      color: #166534;
      background: #dcfce7;
      box-shadow: inset 0 -2px 0 rgb(22 101 52 / 14%);
    }
    .ti-status-dot {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: #e11d48;
      color: #fff;
      font: 900 11px/1 ui-sans-serif, system-ui, sans-serif;
    }
    .ti-status-dot--connected {
      background: #16a34a;
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
    .ti-power-button {
      border: 1px solid rgb(17 24 39 / 14%);
      border-radius: 6px;
      min-height: 32px;
      background: #fff;
      color: #713f12;
      font: 900 12px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .ti-power-button--on {
      background: #111827;
      border-color: #111827;
      color: #fff;
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
    .ti-diagnostics {
      margin-top: 12px;
      border-top: 1px solid rgb(124 45 18 / 16%);
      padding-top: 10px;
    }
    .ti-diagnostics__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: #713f12;
      font: 900 10px/1 ui-sans-serif, system-ui, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 7px;
    }
    .ti-diagnostics__text {
      box-sizing: border-box;
      width: 100%;
      min-height: 118px;
      resize: vertical;
      border: 1px solid rgb(124 45 18 / 22%);
      border-radius: 6px;
      background: #fff;
      color: #171717;
      padding: 9px;
      font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
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
  ensureDocumentStyles();
  mirror = document.createElement("div");
  mirror.className = "ti-textarea-mirror";
  markerLayer = document.createElement("div");
  markerLayer.className = "ti-marker-layer";
  mirror.append(markerLayer);
  document.documentElement.append(mirror);
}

function ensureDocumentStyles() {
  if (document.getElementById(documentStyleId)) return;

  const style = document.createElement("style");
  style.id = documentStyleId;
  style.textContent = `
    .ti-textarea-mirror {
      color: transparent;
      box-sizing: border-box;
    }

    .ti-textarea-mirror * {
      box-sizing: border-box;
    }

    .ti-marker-layer {
      width: 100%;
      min-height: 100%;
    }

    .ti-marker {
      pointer-events: auto;
      text-decoration-line: underline;
      text-decoration-color: #e24646;
      text-decoration-thickness: 2px;
      text-underline-offset: 4px;
      text-decoration-style: wavy;
      color: transparent;
      cursor: pointer;
    }

    .ti-marker--rect {
      color: transparent;
    }
  `;
  document.documentElement.append(style);
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
  if (!overlayState.isEnabled) {
    suggestions = [];
    overlayState = {
      ...overlayState,
      activeSuggestion: null,
      position: null,
      isAnalyzing: false,
      analysisMessage: null
    };
    renderApp();
    renderMarkers();
    return;
  }
  if (!openRouterApiKey) {
    suggestions = [];
    overlayState = {
      ...overlayState,
      activeSuggestion: null,
      position: null,
      isAnalyzing: false,
      analysisMessage: null
    };
    if (activeSurface) writeCachedSuggestions(activeSurface.getText(), suggestions);
    renderApp();
    renderMarkers();
    return;
  }
  overlayState = { ...overlayState, isAnalyzing: true, analysisMessage: null };
  renderApp();
  analyzeTimer = window.setTimeout(analyze, debounceMs);
}

async function analyze() {
  if (!activeSurface) return;
  if (!overlayState.isEnabled) {
    overlayState = { ...overlayState, isAnalyzing: false };
    renderApp();
    renderMarkers();
    return;
  }
  if (!openRouterApiKey) {
    overlayState = { ...overlayState, isAnalyzing: false };
    renderApp();
    renderMarkers();
    return;
  }
  const surface = activeSurface;
  const text = surface.getText();
  const currentRequestId = ++requestId;
  const request = {
    ...extractFocusedWindow(text, surface.getCursorOffset()),
    level: overlayState.level,
    openRouterApiKey
  };
  const startedAt = new Date().toISOString();

  if (!request.windowText.trim()) {
    suggestions = [];
    writeCachedSuggestions(text, suggestions);
    overlayState = { ...overlayState, isAnalyzing: false };
    renderApp();
    renderMarkers();
    return;
  }

  try {
    const parsed = reconcileAnalyzeResponse(request, await analyzeWithOpenRouter(request, openRouterApiKey));
    if (currentRequestId !== requestId || activeSurface !== surface) return;
    suggestions = mergeSuggestions(
      surface.getText(),
      suggestions,
      parsed.suggestions.filter(
        (suggestion) => !dismissedIds.has(suggestion.id) && !appliedIds.has(suggestion.id)
      )
    );
    overlayState = {
      ...overlayState,
      analysisMessage: suggestions.length ? null : "No jargon targets found"
    };
    writeCachedSuggestions(surface.getText(), suggestions);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Analyze failed";
    const networkDiagnostics = await collectNetworkDiagnostics();
    overlayState = {
      ...overlayState,
      analysisMessage: message,
      diagnosticText: createDiagnosticText({
        message,
        startedAt,
        text,
        request,
        networkDiagnostics
      })
    };
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
  const surface = activeSurface;
  const rect = surface.element.getBoundingClientRect();

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
  visibleSuggestions.forEach((suggestion, index) => {
    const rects = surface.getSuggestionClientRects(suggestion);

    if (!rects.length) {
      renderFallbackContentEditableMarker(suggestion, rect, index);
      return;
    }

    for (const markerRect of rects) renderContentEditableMarker(suggestion, markerRect);
  });
}

function renderContentEditableMarker(suggestion: Suggestion, markerRect: DOMRect) {
  if (!markerLayer) return;
  const mark = document.createElement("span");
  mark.className = "ti-marker ti-marker--rect";
  mark.dataset.suggestionId = suggestion.id;
  Object.assign(mark.style, {
    position: "fixed",
    left: `${markerRect.left}px`,
    top: `${markerRect.bottom - 5}px`,
    width: `${Math.max(markerRect.width, 10)}px`,
    height: "12px",
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6' viewBox='0 0 12 6'%3E%3Cpath d='M0 3 Q3 0 6 3 T12 3' fill='none' stroke='%23e11d48' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E\")",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "left bottom",
    backgroundSize: "12px 6px",
    cursor: "pointer",
    pointerEvents: "auto"
  });
  mark.addEventListener("mouseenter", () => showSuggestionFromRect(suggestion, markerRect));
  mark.addEventListener("click", () => showSuggestionFromRect(suggestion, markerRect));
  markerLayer.append(mark);
}

function renderFallbackContentEditableMarker(suggestion: Suggestion, editorRect: DOMRect, index: number) {
  if (!markerLayer) return;
  const mark = document.createElement("button");
  mark.className = "ti-marker-fallback";
  mark.type = "button";
  mark.textContent = suggestion.original;
  const fallbackRect = new DOMRect(
    Math.min(editorRect.left + 8, window.innerWidth - 180),
    Math.min(editorRect.top + 8 + index * 28, window.innerHeight - 44),
    160,
    24
  );
  Object.assign(mark.style, {
    position: "fixed",
    left: `${fallbackRect.left}px`,
    top: `${fallbackRect.top}px`,
    maxWidth: "160px",
    minHeight: "24px",
    border: "1px solid rgb(225 29 72 / 35%)",
    borderRadius: "6px",
    background: "#fff7ed",
    color: "#9f1239",
    font: "800 11px/1 ui-sans-serif, system-ui, sans-serif",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    pointerEvents: "auto",
    zIndex: "2147483647"
  });
  mark.addEventListener("mouseenter", () => showSuggestionFromRect(suggestion, fallbackRect));
  mark.addEventListener("click", () => showSuggestionFromRect(suggestion, fallbackRect));
  markerLayer.append(mark);
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
  if (currentText.slice(suggestion.start, suggestion.end) !== suggestion.original) {
    suggestions = suggestions.filter((item) => item.id !== suggestion.id);
    overlayState = { ...overlayState, activeSuggestion: null, position: null };
    writeCachedSuggestions(currentText, suggestions);
    renderApp();
    renderMarkers();
    return;
  }
  const delta = suggestion.replacement.length - (suggestion.end - suggestion.start);
  const didReplace = activeSurface.replaceRange(suggestion.start, suggestion.end, suggestion.replacement);
  if (!didReplace) {
    console.warn("CEO Speak replacement did not land", {
      suggestion,
      currentText,
      currentSlice: currentText.slice(suggestion.start, suggestion.end),
      afterText: activeSurface.getText()
    });
    activeSurface.focus();
    renderMarkers();
    return;
  }

  appliedIds.add(suggestion.id);
  suggestions = suggestions
    .filter((item) => item.id !== suggestion.id)
    .map((item) =>
      item.start >= suggestion.end
        ? { ...item, start: item.start + delta, end: item.end + delta }
        : item
  );
  overlayState = { ...overlayState, activeSuggestion: null, position: null };
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
  if (activeSurface) writeCachedSuggestions(activeSurface.getText(), suggestions);
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
      onEnabledToggle={toggleEnabled}
      onApiKeyDraftChange={changeApiKeyDraft}
      onApiKeySave={saveApiKey}
      onApiKeyClear={clearApiKey}
      onDiagnosticCopy={copyDiagnostic}
    />
  );
}

async function toggleEnabled() {
  const isEnabled = !overlayState.isEnabled;
  overlayState = {
    ...overlayState,
    isEnabled,
    activeSuggestion: null,
    position: null,
    isAnalyzing: false,
    analysisMessage: null
  };
  await writeSetting(enabledStorageKey, isEnabled ? "true" : "false");

  if (!isEnabled) {
    suggestions = [];
    renderApp();
    renderMarkers();
    return;
  }

  if (activeSurface) {
    suggestions = readCachedSuggestions(activeSurface.getText());
  }
  renderApp();
  renderMarkers();
  queueAnalyze();
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
  suggestions = [];
  overlayState = {
    ...overlayState,
    activeSuggestion: null,
    position: null,
    isAnalyzing: false,
    apiKeyDraft: "",
    hasApiKey: false,
    apiKeyMessage: "Key cleared. Connect an OpenRouter key to analyze text.",
    analysisMessage: null,
    diagnosticText: null
  };
  if (activeSurface) writeCachedSuggestions(activeSurface.getText(), suggestions);
  renderApp();
  renderMarkers();
}

async function copyDiagnostic() {
  if (!overlayState.diagnosticText) return;
  try {
    await navigator.clipboard.writeText(overlayState.diagnosticText);
    overlayState = { ...overlayState, apiKeyMessage: "Diagnostic copied." };
  } catch {
    overlayState = { ...overlayState, apiKeyMessage: "Select the diagnostic text and copy it manually." };
  }
  renderApp();
}

async function analyzeWithOpenRouter(request: AnalyzeRequest, apiKey: string) {
  const response = await fetch(openRouterApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-OpenRouter-Title": "CEO Speak Extension"
    },
    body: JSON.stringify({
      model: openRouterModel,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            `You rewrite plain user text into corporate/consulting jargon for a joke/troll app. ${levelInstructions[request.level]} Return suggestions that transform ordinary wording into corporate speak. Make each message funny, punchy, and cooler than a normal grammar explanation while still explaining the change. Use absolute character offsets based on the provided windowStart. Every suggestion must replace a contiguous exact substring from the input, and original must exactly match that substring. Prefer simple phrase substitutions like "meet" -> "touch base", "discuss" -> "double click on", "later today" -> "by end of day", and "agree" -> "get alignment".`
        },
        {
          role: "user",
          content: JSON.stringify({
            windowStart: request.windowStart,
            text: request.windowText
          })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "writing_suggestions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              suggestions: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    type: { type: "string", enum: ["corporate"] },
                    start: { type: "integer" },
                    end: { type: "integer" },
                    original: { type: "string" },
                    replacement: { type: "string" },
                    message: { type: "string" },
                    confidence: { type: "number", minimum: 0, maximum: 1 }
                  },
                  required: [
                    "id",
                    "type",
                    "start",
                    "end",
                    "original",
                    "replacement",
                    "message",
                    "confidence"
                  ]
                }
              }
            },
            required: ["suggestions"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorBody = await readResponseBody(response);
    throw new Error(`OpenRouter failed: ${response.status}${errorBody ? ` ${errorBody}` : ""}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  const parsedContent = typeof content === "string" ? JSON.parse(content) : content;
  return AnalyzeResponseSchema.parse(parsedContent);
}

const levelInstructions = {
  associate:
    "Associate level: lightly professionalize the text. Prefer modest consulting phrasing, concise wording, and mild terms like align, sync, follow up, and next steps.",
  manager:
    "Manager level: noticeably corporate. Use consulting and workplace jargon such as circle back, touch base, alignment, unblock, socialize, parking lot, double click, and end of day when it fits.",
  ceo:
    "CEO level: aggressively executive and absurdly corporate while still grammatical. Lean into strategy, leverage, cross-functional alignment, north star, stakeholder buy-in, operationalize, unlock value, boil the ocean, and similar jargon."
} satisfies Record<CorporateLevel, string>;

async function readResponseBody(response: Response) {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

function createDiagnosticText({
  message,
  startedAt,
  text,
  request,
  networkDiagnostics
}: {
  message: string;
  startedAt: string;
  text: string;
  request: ReturnType<typeof extractFocusedWindow> & { level: CorporateLevel; openRouterApiKey: string };
  networkDiagnostics: string[];
}) {
  return [
    "CEO Speak diagnostic",
    `time: ${startedAt}`,
    `url: ${openRouterApiUrl}`,
    `model: ${openRouterModel}`,
    `page: ${location.href}`,
    `error: ${message}`,
    `errorKind: ${message === "Failed to fetch" ? "network-or-extension-permission" : "http-or-parse"}`,
    `hasApiKey: ${Boolean(openRouterApiKey)}`,
    `level: ${request.level}`,
    `fullTextLength: ${text.length}`,
    `windowStart: ${request.windowStart}`,
    `windowTextLength: ${request.windowText.length}`,
    `cursorOffset: ${request.cursorOffset}`,
    `windowTextPreview: ${JSON.stringify(request.windowText.slice(0, 240))}`,
    "",
    "Network probes",
    ...networkDiagnostics
  ].join("\n");
}

async function collectNetworkDiagnostics() {
  const manifest = getManifestDiagnostics();
  const probes = await Promise.all([
    probeUrl("https://openrouter.ai/api/v1/models"),
    probeUrl(openRouterApiUrl, {
      method: "OPTIONS"
    })
  ]);

  return [
    `navigator.onLine: ${navigator.onLine}`,
    `secureContext: ${window.isSecureContext}`,
    ...manifest,
    `likelyCause: ${getLikelyNetworkCause(probes)}`,
    ...probes
  ];
}

function getManifestDiagnostics() {
  try {
    const manifest = chrome.runtime.getManifest();
    return [
      `extension.id: ${chrome.runtime.id}`,
      `manifest.version: ${manifest.version}`,
      `manifest.host_permissions: ${JSON.stringify(manifest.host_permissions ?? [])}`,
      `manifest.permissions: ${JSON.stringify(manifest.permissions ?? [])}`
    ];
  } catch (error) {
    return [`manifest.readError: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function probeUrl(url: string, init?: RequestInit) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init
    });
    const body = await readResponseBody(response);
    const elapsedMs = Math.round(performance.now() - startedAt);
    return `${url}: status=${response.status} ok=${response.ok} elapsedMs=${elapsedMs} body=${JSON.stringify(body.slice(0, 300))}`;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    return `${url}: error=${error instanceof Error ? `${error.name}: ${error.message}` : String(error)} elapsedMs=${elapsedMs}`;
  }
}

function getLikelyNetworkCause(probes: string[]) {
  const modelProbe = probes.find((probe) => probe.includes("/models"));
  if (modelProbe?.includes("status=200")) {
    return "OpenRouter is reachable; check API key/model/request details.";
  }

  if (probes.every((probe) => probe.includes("Failed to fetch"))) {
    return "OpenRouter is not reachable from the extension. Check host permissions, network, or browser blocking.";
  }

  return "Unknown network failure; inspect probe statuses below.";
}

async function readSettings(): Promise<{ level: CorporateLevel; openRouterApiKey: string | null; isEnabled: boolean }> {
  const values = await readSetting([levelStorageKey, apiKeyStorageKey, enabledStorageKey]);
  const levelValue = values[levelStorageKey];
  const keyValue = values[apiKeyStorageKey];
  const enabledValue = values[enabledStorageKey];

  return {
    level:
      levelValue === "associate" || levelValue === "manager" || levelValue === "ceo"
        ? levelValue
        : "manager",
    openRouterApiKey: typeof keyValue === "string" && keyValue.trim() ? keyValue : null,
    isEnabled: enabledValue === "false" ? false : true
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

function reconcileAnalyzeResponse(request: AnalyzeRequest, response: AnalyzeResponse): AnalyzeResponse {
  const windowEnd = request.windowStart + request.windowText.length;
  const repaired = response.suggestions.flatMap((suggestion) => {
    if (suggestion.start >= request.windowStart && suggestion.end <= windowEnd) {
      const original = request.windowText.slice(
        suggestion.start - request.windowStart,
        suggestion.end - request.windowStart
      );
      if (original === suggestion.original) return [suggestion];
    }

    const index = findOriginalInWindow(request.windowText, suggestion.original);
    if (index === -1) return [];

    const original = request.windowText.slice(index, index + suggestion.original.length);
    return [
      {
        ...suggestion,
        start: request.windowStart + index,
        end: request.windowStart + index + original.length,
        original
      }
    ];
  });

  return {
    suggestions: repaired
      .filter((suggestion) => {
        if (suggestion.start < request.windowStart || suggestion.end > windowEnd) return false;
        const original = request.windowText.slice(
          suggestion.start - request.windowStart,
          suggestion.end - request.windowStart
        );
        return original === suggestion.original;
      })
      .sort((a, b) => a.start - b.start)
      .slice(0, 12)
  };
}

function findOriginalInWindow(windowText: string, original: string) {
  const directIndex = windowText.indexOf(original);
  if (directIndex !== -1) return directIndex;

  const lowerIndex = windowText.toLowerCase().indexOf(original.toLowerCase());
  if (lowerIndex !== -1) return lowerIndex;

  const normalizedWindow = createNormalizedSearchIndex(windowText);
  const normalizedOriginal = normalizeSearchText(original);
  const normalizedIndex = normalizedWindow.text.indexOf(normalizedOriginal);
  if (normalizedIndex === -1) return -1;
  return normalizedWindow.indexMap[normalizedIndex] ?? -1;
}

function createNormalizedSearchIndex(value: string) {
  let text = "";
  const indexMap: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const normalized = normalizeSearchText(char);
    if (!normalized) continue;
    text += normalized;
    for (let offset = 0; offset < normalized.length; offset += 1) {
      indexMap.push(index);
    }
  }

  return { text, indexMap };
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").toLowerCase();
}

function mergeSuggestions(text: string, current: Suggestion[], incoming: Suggestion[]) {
  const byRange = new Map<string, Suggestion>();
  for (const suggestion of [...current, ...incoming]) {
    if (text.slice(suggestion.start, suggestion.end) !== suggestion.original) continue;
    byRange.set(`${suggestion.start}:${suggestion.end}:${suggestion.original}:${suggestion.replacement}`, suggestion);
  }
  return [...byRange.values()].sort((a, b) => a.start - b.start).slice(0, 12);
}
