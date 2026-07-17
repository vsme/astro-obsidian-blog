import type { APIRoute, GetStaticPaths } from "astro";
import { getImage } from "astro:assets";
import { getCollection } from "astro:content";
import { getPath } from "@/utils/getPath";

const normalizeId = (id: string) => id.replace(/\.(md|mdx)$/, "");
const GALLERY_MAX_EDGE = 2560;
const GALLERY_QUALITY = 82;
const entriesPromise = getCollection("footprints", ({ data }) => !data.draft);
const postsPromise = getCollection("blog", ({ data }) => !data.draft);

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
      const scale = Math.min(
        1,
        GALLERY_MAX_EDGE / Math.max(photo.src.width, photo.src.height)
      );
      const galleryWidth = Math.max(1, Math.round(photo.src.width * scale));
      const galleryHeight = Math.max(1, Math.round(photo.src.height * scale));
      const [thumbnail, galleryImage] = await Promise.all([
        getImage({
          src: photo.src,
          width: 240,
          format: "webp",
          quality: 76,
        }),
        // Astro's Sharp service re-encodes the image without copying source
        // EXIF/GPS/camera metadata into the public gallery asset.
        getImage({
          src: photo.src,
          width: galleryWidth,
          format: "webp",
          quality: GALLERY_QUALITY,
        }),
      ]);

      return {
        thumbnail: thumbnail.src,
        original: galleryImage.src,
        width: galleryWidth,
        height: galleryHeight,
        alt: photo.alt,
        caption: photo.caption,
        position: photo.position,
      };
    })
  );
  const posts = await postsPromise;
  const postsById = new Map(posts.map(post => [post.id, post]));
  const relatedPosts = entry.data.relatedPosts.flatMap(reference => {
    const post = postsById.get(reference.id);
    if (!post) return [];

    return [
      {
        id: post.id,
        title: post.data.title,
        href: getPath(post.id, post.filePath),
      },
    ];
  });

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
      relatedPosts,
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": import.meta.env.PROD
          ? "public, max-age=31536000, immutable"
          : "no-store",
      },
    }
  );
};
