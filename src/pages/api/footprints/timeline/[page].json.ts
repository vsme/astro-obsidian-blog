import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import {
  FOOTPRINT_TIMELINE_PAGE_SIZE,
  serializeFootprintRecord,
  type SerializedFootprintRecord,
} from "@/utils/footprintRecords";

interface FootprintTimelinePageProps {
  payload: {
    records: SerializedFootprintRecord[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      hasMore: boolean;
      itemsPerPage: number;
    };
  };
}

export const getStaticPaths: GetStaticPaths = async () => {
  const [entries, posts] = await Promise.all([
    getCollection(
      "footprints",
      ({ data }) => !data.draft && data.photos.some(photo => !photo.hidden)
    ),
    getCollection("blog", ({ data }) => !data.draft),
  ]);
  const sortedEntries = entries.sort(
    (a, b) => b.data.visitedAt.getTime() - a.data.visitedAt.getTime()
  );
  const postsById = new Map(posts.map(post => [post.id, post]));
  const records = await Promise.all(
    sortedEntries.map(entry => serializeFootprintRecord(entry, postsById))
  );
  const totalPages = Math.ceil(records.length / FOOTPRINT_TIMELINE_PAGE_SIZE);

  return Array.from({ length: Math.max(totalPages, 1) }, (_, index) => {
    const currentPage = index + 1;
    const startIndex = index * FOOTPRINT_TIMELINE_PAGE_SIZE;

    return {
      params: { page: String(currentPage) },
      props: {
        payload: {
          records: records.slice(
            startIndex,
            startIndex + FOOTPRINT_TIMELINE_PAGE_SIZE
          ),
          pagination: {
            currentPage,
            totalPages,
            totalItems: records.length,
            hasMore: currentPage < totalPages,
            itemsPerPage: FOOTPRINT_TIMELINE_PAGE_SIZE,
          },
        },
      } satisfies FootprintTimelinePageProps,
    };
  });
};

export const GET: APIRoute = ({ props }) => {
  const { payload } = props as FootprintTimelinePageProps;

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": import.meta.env.PROD
        ? "public, max-age=31536000, immutable"
        : "no-store",
    },
  });
};
