import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import {
  normalizeFootprintId,
  serializeFootprintRecord,
} from "@/utils/footprintRecords";

const entriesPromise = getCollection(
  "footprints",
  ({ data }) => !data.draft && data.photos.some(photo => !photo.hidden)
);
const postsPromise = getCollection("blog", ({ data }) => !data.draft);

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await entriesPromise;

  return entries.map(entry => ({
    params: { id: normalizeFootprintId(entry.id) },
  }));
};

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  const entries = await entriesPromise;
  const entry = entries.find(item => normalizeFootprintId(item.id) === id);

  if (!entry) {
    return new Response(JSON.stringify({ error: "Footprint not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const posts = await postsPromise;
  const postsById = new Map(posts.map(post => [post.id, post]));
  const record = await serializeFootprintRecord(entry, postsById);

  return new Response(JSON.stringify(record), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": import.meta.env.PROD
        ? "public, max-age=0, must-revalidate"
        : "no-store",
    },
  });
};
