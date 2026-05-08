import type { Suggestion } from "@text-intel/shared";

export type TextSurface = {
  element: HTMLElement;
  getText: () => string;
  getCursorOffset: () => number;
  getSuggestionClientRects: (suggestion: Suggestion) => DOMRect[];
  replaceRange: (start: number, end: number, replacement: string) => boolean;
  focus: () => void;
};

export function createTextSurface(element: HTMLElement): TextSurface | null {
  if (element instanceof HTMLTextAreaElement) return createTextareaSurface(element);
  if (isEditableElement(element)) return createContentEditableSurface(element);
  return null;
}

export function findEditableFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const editable = target.closest<HTMLElement>(
    'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label="Message Body"]'
  );
  if (!editable) return null;
  if (editable instanceof HTMLTextAreaElement) return editable;
  return isEditableElement(editable) ? editable : null;
}

export function findInitiallyFocusedEditable(): HTMLElement | null {
  return findEditableFromEventTarget(document.activeElement);
}

export function findGmailComposeBodies(root: ParentNode = document): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label="Message Body"]'
    )
  ).filter(isEditableElement);
}

function createTextareaSurface(textarea: HTMLTextAreaElement): TextSurface {
  return {
    element: textarea,
    getText: () => textarea.value,
    getCursorOffset: () => textarea.selectionStart,
    getSuggestionClientRects: () => [],
    replaceRange: (start, end, replacement) => {
      const nextValue = `${textarea.value.slice(0, start)}${replacement}${textarea.value.slice(end)}`;
      textarea.value = nextValue;
      const cursor = start + replacement.length;
      textarea.setSelectionRange(cursor, cursor);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      return textarea.value === nextValue;
    },
    focus: () => textarea.focus()
  };
}

function createContentEditableSurface(element: HTMLElement): TextSurface {
  return {
    element,
    getText: () => getEditableText(element),
    getCursorOffset: () => getSelectionOffset(element),
    getSuggestionClientRects: (suggestion) => {
      const range = createRangeForOffsets(element, suggestion.start, suggestion.end);
      if (!range) return [];
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) {
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) rects.push(rect);
      }
      range.detach();
      return rects;
    },
    replaceRange: (start, end, replacement) => {
      const currentText = getEditableText(element);
      const expectedText = `${currentText.slice(0, start)}${replacement}${currentText.slice(end)}`;
      if (currentText.slice(start, end) === replacement) return true;
      const range = createRangeForOffsets(element, start, end);
      if (!range) return false;
      element.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      range.deleteContents();
      const node = document.createTextNode(replacement);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);

      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      range.detach();
      return getEditableText(element) === expectedText;
    },
    focus: () => element.focus()
  };
}

function isEditableElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.getAttribute("contenteditable") === "true";
}

function getSelectionOffset(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer)) return textLength(container);

  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    if (node === range.startContainer) return offset + range.startOffset;
    offset += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }

  return offset;
}

function createRangeForOffsets(container: HTMLElement, start: number, end: number): Range | null {
  const textEnd = textLength(container);
  const safeStart = Math.max(0, Math.min(start, textEnd));
  const safeEnd = Math.max(safeStart, Math.min(end, textEnd));
  const startPoint = findTextPoint(container, safeStart);
  const endPoint = findTextPoint(container, safeEnd);
  if (!startPoint || !endPoint) return null;

  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function findTextPoint(container: HTMLElement, targetOffset: number) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let lastTextNode: Text | null = null;

  while (node) {
    const textNode = node as Text;
    const length = textNode.textContent?.length ?? 0;
    if (targetOffset <= offset + length) {
      return { node: textNode, offset: targetOffset - offset };
    }
    offset += length;
    lastTextNode = textNode;
    node = walker.nextNode();
  }

  if (lastTextNode) return { node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0 };
  const fallback = document.createTextNode("");
  container.append(fallback);
  return { node: fallback, offset: 0 };
}

function textLength(container: HTMLElement) {
  return getEditableText(container).length;
}

function getEditableText(element: HTMLElement) {
  return element.textContent ?? "";
}
