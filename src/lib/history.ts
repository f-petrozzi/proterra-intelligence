import { z } from "astro/zod";
import rawHistory from "../data/history.json";
import { sourceById } from "./content";

const historyPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}$/),
  label: z.string().min(3),
  value: z.number()
});

const historyChartSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  sector: z.string().min(3),
  region: z.string().min(3),
  title: z.string().min(5),
  question: z.string().min(15),
  description: z.string().min(15),
  period: z.string().min(3),
  cadence: z.string().min(3),
  basis: z.string().min(20),
  unit: z.string().min(3),
  format: z.enum(["integer", "decimal-1", "currency-2"]),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceId: z.string(),
  sourceUrl: z.url(),
  sourceTitle: z.string().min(5),
  note: z.string().min(20),
  series: z.array(z.object({
    label: z.string().min(3),
    definition: z.string().min(20),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    points: z.array(historyPointSchema).min(2)
  })).min(1).max(4)
});

const historySchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  charts: z.array(historyChartSchema).min(1)
});

export const history = historySchema.parse(rawHistory);
export type HistoryChart = (typeof history)["charts"][number];

for (const chart of history.charts) {
  const source = sourceById.get(chart.sourceId);
  if (!source) throw new Error(`History chart "${chart.id}" references unknown source "${chart.sourceId}".`);
  const hostname = new URL(chart.sourceUrl).hostname.replace(/^www\./, "");
  const domain = source.domain.replace(/^www\./, "");
  if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
    throw new Error(`History chart "${chart.id}" does not use its registered source domain.`);
  }
}
