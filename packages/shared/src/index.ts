import { z } from "zod";

export const CorporateLevelSchema = z.enum(["associate", "manager", "ceo"]);
export type CorporateLevel = z.infer<typeof CorporateLevelSchema>;

export const SuggestionTypeSchema = z.enum(["spelling", "clarity", "corporate"]);
export type SuggestionType = z.infer<typeof SuggestionTypeSchema>;

export const AnalyzeRequestSchema = z.object({
  fullTextLength: z.number().int().nonnegative(),
  windowText: z.string().min(1),
  windowStart: z.number().int().nonnegative(),
  cursorOffset: z.number().int().nonnegative(),
  level: CorporateLevelSchema.default("manager"),
  openRouterApiKey: z.string().trim().min(1).optional()
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const SuggestionSchema = z.object({
  id: z.string().min(1),
  type: SuggestionTypeSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  original: z.string(),
  replacement: z.string().min(1),
  message: z.string().min(1),
  confidence: z.number().min(0).max(1)
}).refine((value) => value.end > value.start, {
  message: "Suggestion end must be greater than start",
  path: ["end"]
});

export type Suggestion = z.infer<typeof SuggestionSchema>;

export const AnalyzeResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema).max(12)
});

export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export function extractFocusedWindow(
  text: string,
  cursorOffset: number,
  maxChars = 1200
): AnalyzeRequest {
  const safeCursor = Math.max(0, Math.min(cursorOffset, text.length));
  const paragraphStart = text.lastIndexOf("\n", safeCursor - 1) + 1;
  const nextBreak = text.indexOf("\n", safeCursor);
  const paragraphEnd = nextBreak === -1 ? text.length : nextBreak;
  const paragraphLength = paragraphEnd - paragraphStart;

  if (paragraphLength <= maxChars) {
    return {
      fullTextLength: text.length,
      windowText: text.slice(paragraphStart, paragraphEnd),
      windowStart: paragraphStart,
      cursorOffset: safeCursor,
      level: "manager"
    };
  }

  const half = Math.floor(maxChars / 2);
  const windowStart = Math.max(paragraphStart, safeCursor - half);
  const windowEnd = Math.min(paragraphEnd, windowStart + maxChars);

  return {
    fullTextLength: text.length,
    windowText: text.slice(windowStart, windowEnd),
    windowStart,
    cursorOffset: safeCursor,
    level: "manager"
  };
}

export function applySuggestion(text: string, suggestion: Suggestion): string {
  return `${text.slice(0, suggestion.start)}${suggestion.replacement}${text.slice(suggestion.end)}`;
}

export function normalizeSuggestions(
  request: AnalyzeRequest,
  response: AnalyzeResponse
): AnalyzeResponse {
  const windowEnd = request.windowStart + request.windowText.length;

  return {
    suggestions: response.suggestions
      .filter((suggestion) => {
        if (suggestion.start < request.windowStart || suggestion.end > windowEnd) return false;
        const original = request.windowText.slice(
          suggestion.start - request.windowStart,
          suggestion.end - request.windowStart
        );
        return original === suggestion.original;
      })
      .slice(0, 12)
  };
}
