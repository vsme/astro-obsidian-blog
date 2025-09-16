import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { remarkMark } from "remark-mark-highlight";
import remarkToc from "remark-toc";
import rehypeFigure from "rehype-figure";
import rehypeSlug from "rehype-slug";

import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { transformerFileName } from "./src/utils/transformers/fileName";
import { SITE } from "./src/config";

import react from "@astrojs/react";
import remarkWrap from "./src/utils/remarkWrap";
import rehypeHeadingLinks from "./src/utils/rehypeHeadingLinks";
import { remarkMediaCard } from "./src/utils/remarkMediaCard";
import pagefind from "astro-pagefind";

import compress from "astro-compress";

// https://astro.build/config
export default defineConfig({
  site: SITE.website,
  build: {
    format: "directory",
  },
  integrations: [
    mdx({ extendMarkdownConfig: true }),
    sitemap({
      filter: page => SITE.showArchives || !page.endsWith("/archives"),
    }),
    react(),
    pagefind(),
    compress({
      CSS: true,
      HTML: {
        "html-minifier-terser": {
          removeComments: true,
          collapseWhitespace: true,
          removeEmptyAttributes: true,
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          useShortDoctype: true,
          minifyCSS: true,
          minifyJS: true,
          removeAttributeQuotes: true,
          preserveLineBreaks: false,
        },
      },
      JavaScript: true,
      SVG: true,
      Image: false,
    }),
  ],
  markdown: {
    remarkPlugins: [
      [remarkMediaCard, { enableDebug: false }],
      [remarkToc, { heading: "目录" }],
      remarkMark,
      [remarkWrap, { className: "article-toc-nav" }],
    ],
    rehypePlugins: [rehypeSlug, rehypeFigure, rehypeHeadingLinks],
    shikiConfig: {
      // For more themes, visit https://shiki.style/themes
      themes: { light: "min-light", dark: "night-owl" },
      defaultColor: false,
      wrap: false,
      // 为自定义卡片语言创建别名，映射到 yaml 语法高亮
      langAlias: {
        "card-movie": "yaml",
        "card-tv": "yaml",
        "card-book": "yaml",
        "card-music": "yaml",
        imgs: "markdown",
      },
      transformers: [
        transformerFileName({ style: "v2", hideDot: false }),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationDiff({ matchAlgorithm: "v3" }),
      ],
    },
  },
  vite: {
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react-dom/client": "preact/compat",
        "react-dom/server": "preact/compat/server",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-runtime",
      },
      dedupe: ["react", "react-dom"],
    },
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
    esbuild: {
      drop: ["console", "debugger"],
    },
  },
  image: {
    responsiveStyles: true,
    layout: "constrained",
  },
  env: {
    schema: {
      PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
      SUPABASE_URL: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
      SUPABASE_KEY: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
  },
  experimental: {
    preserveScriptOrder: true,
  },
});
