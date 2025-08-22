import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { parseEntry } from "@/utils/parseEntry";

export const getStaticPaths: GetStaticPaths = async () => {
  const diaryEntries = await getCollection("diary");
  const ITEMS_PER_PAGE = 5;
  const totalPages = Math.ceil(diaryEntries.length / ITEMS_PER_PAGE);

  return Array.from({ length: totalPages }, (_, i) => ({
    params: { page: String(i + 1) },
  }));
};

export const GET: APIRoute = async ({ params }) => {
  try {
    const page = parseInt(params.page || "1");
    const ITEMS_PER_PAGE = 5;

    // 获取所有日记条目
    const diaryEntries = await getCollection("diary");

    // 按文件名（日期）排序，最新的在前
    const sortedEntries = diaryEntries.sort((a, b) => {
      const dateA = a.id.replace(".md", "");
      const dateB = b.id.replace(".md", "");
      return dateB.localeCompare(dateA);
    });

    // 计算分页
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageEntries = sortedEntries.slice(startIndex, endIndex);

    // 解析条目
    const parsedEntries = await Promise.all(pageEntries.map(parseEntry));

    // 计算分页信息
    const totalPages = Math.ceil(sortedEntries.length / ITEMS_PER_PAGE);

    return new Response(
      JSON.stringify({
        entries: parsedEntries,
        pagination: {
          currentPage: page,
          totalPages,
          hasMore: page < totalPages,
          itemsPerPage: ITEMS_PER_PAGE,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching diary entries:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch diary entries" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};
