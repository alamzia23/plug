import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The blog is the ranking engine: one post per long-tail question people
// actually type before they ask for a referral.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    // Written by hand, never generated from the body — it's the SERP snippet.
    description: z.string().max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
