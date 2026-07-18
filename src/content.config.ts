import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";
import { SITE, BLOG_PATH, DIARY_PATH, FOOTPRINTS_PATH } from "@/config";

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

const footprints = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.{md,mdx}",
    base: `./${FOOTPRINTS_PATH}`,
  }),
  schema: ({ image }) =>
    z.object({
      visitedAt: z.date(),
      country: z.string(),
      city: z.string(),
      district: z.string().optional(),
      town: z.string().optional(),
      street: z.string().optional(),
      place: z.string(),
      region: z.string(),
      coordinates: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      draft: z.boolean().optional(),
      relatedPosts: z.array(reference("blog")).default([]),
      photos: z
        .array(
          z.object({
            src: image(),
            alt: z.string(),
            caption: z.string().optional(),
            position: z.string().optional(),
            hidden: z.boolean().optional(),
          })
        )
        .min(1),
    }),
});

export const collections = { blog, diary, footprints };
