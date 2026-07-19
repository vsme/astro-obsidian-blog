import { getImage } from "astro:assets";
import type { CollectionEntry } from "astro:content";
import { getPath } from "@/utils/getPath";

export const FOOTPRINT_TIMELINE_PAGE_SIZE = 8;

const GALLERY_MAX_EDGE = 2560;
const GALLERY_QUALITY = 82;

export const normalizeFootprintId = (id: string) =>
  id.replace(/\.(md|mdx)$/, "");

export const serializeFootprintRecord = async (
  entry: CollectionEntry<"footprints">,
  postsById: ReadonlyMap<string, CollectionEntry<"blog">>
) => {
  const photos = await Promise.all(
    entry.data.photos
      .filter(photo => !photo.hidden)
      .map(async photo => {
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
          // Re-encode gallery images without copying source EXIF/GPS metadata.
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

  return {
    id: normalizeFootprintId(entry.id),
    visitedAt: entry.data.visitedAt.toISOString(),
    country: entry.data.country,
    city: entry.data.city,
    place: entry.data.place,
    region: entry.data.region,
    note: entry.body?.trim() ?? "",
    photos,
    relatedPosts,
  };
};

export type SerializedFootprintRecord = Awaited<
  ReturnType<typeof serializeFootprintRecord>
>;
