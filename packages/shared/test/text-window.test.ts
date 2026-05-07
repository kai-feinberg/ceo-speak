import { describe, expect, it } from "vitest";
import { applySuggestion, extractFocusedWindow, normalizeSuggestions } from "../src";

describe("text window helpers", () => {
  it("extracts the active paragraph with absolute offsets", () => {
    const text = "First paragraph.\nThis sentnce needs help.\nLast paragraph.";
    const request = extractFocusedWindow(text, 23);

    expect(request.windowText).toBe("This sentnce needs help.");
    expect(request.windowStart).toBe(17);
    expect(request.fullTextLength).toBe(text.length);
  });

  it("applies suggestions by absolute range", () => {
    const result = applySuggestion("This sentnce works.", {
      id: "s1",
      type: "spelling",
      start: 5,
      end: 12,
      original: "sentnce",
      replacement: "sentence",
      message: "Fix spelling",
      confidence: 0.9
    });

    expect(result).toBe("This sentence works.");
  });

  it("drops suggestions whose original text no longer matches", () => {
    const request = extractFocusedWindow("This sentence works.", 8);
    const response = normalizeSuggestions(request, {
      suggestions: [
        {
          id: "s1",
          type: "spelling",
          start: 5,
          end: 12,
          original: "sentnce",
          replacement: "sentence",
          message: "Fix spelling",
          confidence: 0.9
        }
      ]
    });

    expect(response.suggestions).toHaveLength(0);
  });
});
