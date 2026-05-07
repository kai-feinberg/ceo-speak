import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import {
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  normalizeSuggestions,
  type AnalyzeResponse
} from "@text-intel/shared";

dotenv.config();

const port = Number(process.env.PORT ?? 8787);
const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const apiKey = process.env.OPENROUTER_API_KEY;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "64kb" }));

const openai = apiKey
  ? new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:5173",
        "X-OpenRouter-Title": "Text Intelligence Extension"
      }
    })
  : null;

app.get("/health", (_req, res) => {
  res.json({ ok: true, model, inference: openai ? "openrouter" : "mock" });
});

app.post("/api/analyze", async (req, res) => {
  const parsed = AnalyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  try {
    const client = getOpenRouterClient(parsed.data.openRouterApiKey);
    const ruleResponse = analyzeWithRules(parsed.data.windowText, parsed.data.windowStart, parsed.data.level);
    let response = ruleResponse;

    if (client) {
      try {
        response = mergeAnalyzeResponses(await analyzeWithOpenRouter(parsed.data, client), ruleResponse);
      } catch (error) {
        console.warn("OpenRouter analysis failed; using local corporate rules.", error);
      }
    }

    res.json(normalizeSuggestions(parsed.data, response));
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to analyze text" });
  }
});

function getOpenRouterClient(userApiKey?: string) {
  if (!userApiKey) return openai;

  return new OpenAI({
    apiKey: userApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:5173",
      "X-OpenRouter-Title": "Text Intelligence Extension"
    }
  });
}

async function analyzeWithOpenRouter(
  request: {
    windowText: string;
    windowStart: number;
    level: "associate" | "manager" | "ceo";
  },
  client: OpenAI
): Promise<AnalyzeResponse> {
  const levelInstructions = {
    associate:
      "Associate level: lightly professionalize the text. Prefer modest consulting phrasing, concise wording, and mild terms like align, sync, follow up, and next steps.",
    manager:
      "Manager level: noticeably corporate. Use consulting and workplace jargon such as circle back, touch base, alignment, unblock, socialize, parking lot, double click, and end of day when it fits.",
    ceo:
      "CEO level: aggressively executive and absurdly corporate while still grammatical. Lean into strategy, leverage, cross-functional alignment, north star, stakeholder buy-in, operationalize, unlock value, boil the ocean, and similar jargon."
  } satisfies Record<typeof request.level, string>;

  const completion = await client.chat.completions.create({
    model,
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
  });

  const content = completion.choices[0]?.message?.content;
  const json = typeof content === "string" ? JSON.parse(content) : content;
  return AnalyzeResponseSchema.parse(json);
}

function analyzeWithRules(
  windowText: string,
  windowStart: number,
  level: "associate" | "manager" | "ceo"
): AnalyzeResponse {
  const fixtures = {
    associate: [
      { original: "talk about", replacement: "discuss", message: "Tiny suit jacket upgrade. Still human, just expense-report adjacent." },
      { original: "later today", replacement: "by end of day", message: "Adds deadline energy without summoning the calendar police." },
      { original: "meet", replacement: "sync", message: "A humble glow-up from normal plans to workplace ritual." },
      { original: "agree", replacement: "align", message: "Makes agreement sound like a tiny strategy summit." }
    ],
    manager: [
      { original: "talk about", replacement: "double click on", message: "Instant consulting cologne. Now it smells billable." },
      { original: "later today", replacement: "by end of day", message: "Turns a time into a managerial drumbeat." },
      { original: "meet", replacement: "touch base", message: "Nobody meets anymore. We touch bases like champions." },
      { original: "agree", replacement: "get alignment", message: "Consensus, but with a lanyard and a parking-lot doc." }
    ],
    ceo: [
      {
        original: "talk about",
        replacement: "double click on the strategic implications of",
        message: "Launches this sentence into executive orbit. Oxygen optional."
      },
      {
        original: "later today",
        replacement: "by end of day to maintain cross-functional momentum",
        message: "Adds urgency, momentum, and the faint sound of a board deck opening."
      },
      {
        original: "meet",
        replacement: "convene a stakeholder alignment touchpoint",
        message: "Transforms a basic meetup into a calendar event with a valuation."
      },
      {
        original: "agree",
        replacement: "secure strategic alignment",
        message: "Agreement is nice. Strategic alignment wears sunglasses indoors."
      },
      {
        original: "plan",
        replacement: "north-star roadmap",
        message: "A normal plan, upgraded into something that can survive a keynote."
      }
    ]
  } satisfies Record<typeof level, Array<{ original: string; replacement: string; message: string }>>;

  return {
    suggestions: fixtures[level].flatMap((fixture, index) => {
      const localStart = windowText.toLowerCase().indexOf(fixture.original);
      if (localStart === -1) return [];
      return [
        {
          id: `mock-${index}`,
          type: "corporate",
          start: windowStart + localStart,
          end: windowStart + localStart + fixture.original.length,
          original: windowText.slice(localStart, localStart + fixture.original.length),
          replacement: fixture.replacement,
          message: fixture.message,
          confidence: 0.92
        } as const
      ];
    })
  };
}

function mergeAnalyzeResponses(primary: AnalyzeResponse, fallback: AnalyzeResponse): AnalyzeResponse {
  const merged = new Map<string, AnalyzeResponse["suggestions"][number]>();
  for (const suggestion of [...primary.suggestions, ...fallback.suggestions]) {
    merged.set(`${suggestion.start}:${suggestion.end}:${suggestion.original}`, suggestion);
  }
  return { suggestions: [...merged.values()].sort((a, b) => a.start - b.start).slice(0, 12) };
}

app.listen(port, () => {
  console.log(`Text intelligence API listening on http://localhost:${port}`);
});
