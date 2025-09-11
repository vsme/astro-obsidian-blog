import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { SITE } from "@/config";

export const BLOG_PATH = "src/data/blog";
export const DIARY_PATH = "src/data/diary";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: `./${BLOG_PATH}` }),
  schema: ({ image }) =>
    z.object({
      author: z.string().default(SITE.author),
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),
      title: z.string(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).default(["其他"]),
      ogImage: image().or(z.string()).optional(),
      description: z.string(),
      canonicalURL: z.string().optional(),
      hideEditPost: z.boolean().optional(),
      timezone: z.string().optional(),
      summary: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      mainPoints: z.array(z.string()).optional(),
    }),
});

const diary = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: `./${DIARY_PATH}` }),
  schema: z.object({
    tags: z.array(z.string()).default(["Diary"]),
    draft: z.boolean().optional(),
  }),
});

export const collections = { blog, diary };
