import express from "express";
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

const app = express();
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Leasely server listening on http://0.0.0.0:${PORT} (model: ${MODEL})`);
});
