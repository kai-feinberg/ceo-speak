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
    const response = openai
      ? await analyzeWithOpenRouter(parsed.data)
      : analyzeWithMock(parsed.data.windowText, parsed.data.windowStart);

    res.json(normalizeSuggestions(parsed.data, response));
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to analyze text" });
  }
});

async function analyzeWithOpenRouter(request: {
  windowText: string;
  windowStart: number;
}): Promise<AnalyzeResponse> {
  const completion = await openai!.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are a precise writing assistant. Return only spelling or clarity suggestions that improve the text. Use absolute character offsets based on the provided windowStart. Do not suggest changes unless the replacement is clearly better."
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
                  type: { type: "string", enum: ["spelling", "clarity"] },
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

function analyzeWithMock(windowText: string, windowStart: number): AnalyzeResponse {
  const fixtures = [
    { original: "sentnce", replacement: "sentence", message: "Fix spelling" },
    { original: "teh", replacement: "the", message: "Fix spelling" },
    { original: "very very", replacement: "very", message: "Remove repetition" },
    { original: "in order to", replacement: "to", message: "Make this more concise" }
  ];

  return {
    suggestions: fixtures.flatMap((fixture, index) => {
      const localStart = windowText.toLowerCase().indexOf(fixture.original);
      if (localStart === -1) return [];
      return [
        {
          id: `mock-${index}`,
          type: fixture.message.includes("spelling") ? "spelling" : "clarity",
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

app.listen(port, () => {
  console.log(`Text intelligence API listening on http://localhost:${port}`);
});
