import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3001);
const MODEL = process.env.MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.EFFORT ?? "medium") as "low" | "medium" | "high";
// Server-side fallback re-runs a declined request on another model. Only some
// models support it, so it can be switched off with ENABLE_FALLBACKS=false.
const ENABLE_FALLBACKS = process.env.ENABLE_FALLBACKS !== "false";

const CATEGORIES = [
  "parties",
  "premises",
  "term_and_dates",
  "rent",
  "escalations",
  "security_deposit",
  "operating_expenses",
  "permitted_use",
  "maintenance_and_repairs",
  "insurance_and_indemnity",
  "renewal_and_options",
  "termination_and_default",
  "assignment_and_subletting",
  "other",
] as const;

const LeaseExtraction = z.object({
  is_lease_document: z
    .boolean()
    .describe("False if the image does not look like a page from a lease."),
  page_summary: z
    .string()
    .describe("One or two sentences describing what this page covers."),
  terms: z.array(
    z.object({
      category: z.enum(CATEGORIES),
      label: z.string().describe('Short name for the term, e.g. "Base Rent".'),
      value: z
        .string()
        .describe("The term in plain English, with exact figures and dates."),
      source_text: z
        .string()
        .describe("A short verbatim excerpt from the page supporting this term."),
    }),
  ),
  warnings: z
    .array(z.string())
    .describe(
      "Legibility problems, cut-off text, or ambiguities the reader should know about.",
    ),
});

export type LeaseExtraction = z.infer<typeof LeaseExtraction>;

const SYSTEM_PROMPT = `You review photographed or scanned pages of commercial real estate leases and extract the business and legal terms a tenant, landlord, or broker would care about.

Extract only what is actually on the page. Do not infer terms that are not stated, and do not fill in typical market terms. If a figure is partially illegible, include what you can read and add a warning rather than guessing.

Keep each value concise but complete: include amounts, currencies, percentages, square footage, dates, notice periods, and who bears the obligation. Prefer one term per distinct obligation or right. Use "other" only when no category fits.`;

const client = new Anthropic();
const app = express();
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

const ExtractRequest = z.object({
  imageBase64: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

app.post("/extract", async (req, res) => {
  const parsedBody = ExtractRequest.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Expected { imageBase64, mediaType }." });
    return;
  }
  const { imageBase64, mediaType } = parsedBody.data;

  const started = Date.now();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: EFFORT,
        format: betaZodOutputFormat(LeaseExtraction),
      },
      ...(ENABLE_FALLBACKS
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            { type: "text", text: "Extract the lease terms from this page." },
          ],
        },
      ],
    });

    console.log(
      `extract: ${response.stop_reason} via ${response.model} in ${Date.now() - started}ms`,
    );

    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to process this image." });
      return;
    }
    if (response.stop_reason === "max_tokens") {
      res.status(502).json({ error: "The response was cut off. Try again." });
      return;
    }
    if (!response.parsed_output) {
      res.status(502).json({ error: "Could not parse the model's response." });
      return;
    }

    res.json(response.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Invalid or missing ANTHROPIC_API_KEY");
      res.status(500).json({ error: "Server is missing a valid API key." });
    } else if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Rate limited. Wait a moment and retry." });
    } else if (error instanceof Anthropic.BadRequestError) {
      console.error("Bad request:", error.message);
      res.status(400).json({ error: error.message });
    } else if (error instanceof Anthropic.APIError) {
      console.error(`API error ${error.status}:`, error.message);
      res.status(502).json({ error: "Upstream API error. Try again." });
    } else {
      console.error(error);
      res.status(500).json({ error: "Unexpected server error." });
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Leasely server listening on http://0.0.0.0:${PORT} (model: ${MODEL})`);
});
