import type { APIRoute, GetStaticPaths } from "astro";
import { getImage } from "astro:assets";
import { getCollection } from "astro:content";

const normalizeId = (id: string) => id.replace(/\.(md|mdx)$/, "");
const entriesPromise = getCollection(
  "footprints",
  ({ data }) => !data.draft
);

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await entriesPromise;

  return entries.map(entry => ({
    params: { id: normalizeId(entry.id) },
  }));
};

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  const entries = await entriesPromise;
  const entry = entries.find(item => normalizeId(item.id) === id);

  if (!entry) {
    return new Response(JSON.stringify({ error: "Footprint not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const photos = await Promise.all(
    entry.data.photos.map(async photo => {
      const thumbnail = await getImage({
        src: photo.src,
        width: 240,
        format: "webp",
        quality: 76,
      });

      return {
        thumbnail: thumbnail.src,
        original: photo.src.src,
        width: photo.src.width,
        height: photo.src.height,
        alt: photo.alt,
        caption: photo.caption,
        position: photo.position,
      };
    })
  );

  return new Response(
    JSON.stringify({
      id: normalizeId(entry.id),
      visitedAt: entry.data.visitedAt.toISOString(),
      country: entry.data.country,
      city: entry.data.city,
      place: entry.data.place,
      region: entry.data.region,
      note: entry.body?.trim() ?? "",
      photos,
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
};
