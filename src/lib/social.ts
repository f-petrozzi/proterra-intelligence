import { z } from "astro/zod";
import rawWatchlist from "../../config/social-watchlist.json";
import { sectors } from "./content";

const accountSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(3),
  url: z.url().refine((value) => new URL(value).hostname.endsWith("linkedin.com"), "Account URL must use linkedin.com."),
  category: z.string().min(3),
  sectors: z.array(z.enum(sectors)).min(1),
  regions: z.array(z.string().min(2)).min(1),
  reason: z.string().min(20)
});

const watchlistSchema = z.object({
  linkedin: z.object({
    mode: z.literal("manual-only"),
    accounts: z.array(accountSchema),
    rules: z.array(z.string().min(10)).min(1)
  })
});

export const socialWatchlist = watchlistSchema.parse(rawWatchlist);
export const linkedinAccounts = socialWatchlist.linkedin.accounts;
export type LinkedInAccount = (typeof linkedinAccounts)[number];
