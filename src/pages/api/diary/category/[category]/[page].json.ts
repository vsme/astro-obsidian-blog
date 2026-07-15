import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { parseEntry } from "@/utils/parseEntry";
import {
  DIARY_CATEGORIES,
  entryMatchesDiaryCategory,
} from "@/utils/diaryCategories";

const ITEMS_PER_PAGE = 5;

interface CategoryPageProps {
  payload: {
    entries: Awaited<ReturnType<typeof parseEntry>>[];
    pagination: {
      currentPage: number;
      totalPages: number;
      hasMore: boolean;
      itemsPerPage: number;
    };
  };
}

export const getStaticPaths: GetStaticPaths = async () => {
  const diaryEntries = await getCollection("diary");
  const publishedEntries = diaryEntries
    .filter(entry => !entry.data.draft)
    .sort((a, b) => {
      const dateA = a.id.replace(".md", "");
      const dateB = b.id.replace(".md", "");
      return dateB.localeCompare(dateA);
    });
  const parsedEntries = await Promise.all(publishedEntries.map(parseEntry));

  return DIARY_CATEGORIES.flatMap(category => {
    const categoryEntries = parsedEntries.filter(entry =>
      entryMatchesDiaryCategory(entry, category)
    );
    const totalPages = Math.ceil(categoryEntries.length / ITEMS_PER_PAGE);
    const generatedPages = Math.max(totalPages, 1);

    return Array.from({ length: generatedPages }, (_, index) => {
      const currentPage = index + 1;
      const startIndex = index * ITEMS_PER_PAGE;

      return {
        params: { category, page: String(currentPage) },
        props: {
          payload: {
            entries: categoryEntries.slice(
              startIndex,
              startIndex + ITEMS_PER_PAGE
            ),
            pagination: {
              currentPage,
              totalPages,
              hasMore: currentPage < totalPages,
              itemsPerPage: ITEMS_PER_PAGE,
            },
          },
        } satisfies CategoryPageProps,
      };
    });
  });
};

export const GET: APIRoute = ({ props }) => {
  const { payload } = props as CategoryPageProps;

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};
