import { z } from "astro/zod";
import rawImages from "../data/editorial-images.json";

const editorialImageSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  src: z.string().startsWith("/images/editorial/"),
  alt: z.string().min(12),
  creator: z.string().min(3),
  provider: z.literal("Wikimedia Commons"),
  license: z.string().min(3),
  sourceUrl: z.url()
});

export type EditorialImage = z.infer<typeof editorialImageSchema>;
export const editorialImages = editorialImageSchema.array().parse(rawImages) satisfies EditorialImage[];

if (new Set(editorialImages.map((image) => image.id)).size !== editorialImages.length) {
  throw new Error("Editorial image IDs must be unique.");
}

export const imageById = new Map(editorialImages.map((image) => [image.id, image]));
