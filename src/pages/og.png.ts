import type { APIRoute } from "astro";
import { generateOgImageForSite } from "@/utils/generateOgImages";
import { SITE } from "@/config";

export const GET: APIRoute = async () => {
  if (SITE.ogImage) {
    return new Response(null, {
      status: 404,
      statusText: "Not found",
    });
  }

  return new Response(await generateOgImageForSite(), {
    headers: { "Content-Type": "image/png" },
  });
};
