import { useEffect, useState } from "react";
import Giscus from "@giscus/react";
import {
  PUBLIC_GISCUS_HOST,
  PUBLIC_GISCUS_REPO,
  PUBLIC_GISCUS_REPO_ID,
  PUBLIC_GISCUS_CATEGORY,
  PUBLIC_GISCUS_CATEGORY_ID,
  PUBLIC_GISCUS_LANG,
} from "astro:env/client";

function detectTheme(): "light" | "dark" | "preferred_color_scheme" {
  if (typeof window === "undefined") return "preferred_color_scheme";
  const dataTheme = document.documentElement.getAttribute("data-theme");
  if (dataTheme === "dark" || dataTheme === "light") return dataTheme;
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export default function Comments() {
  const [theme, setTheme] = useState<
    "light" | "dark" | "preferred_color_scheme"
  >(detectTheme());

  // 跟随站内切换
  useEffect(() => {
    // 站内按钮会切换 theme，用 MO 监听
    const mo = new MutationObserver(() => {
      const dataTheme = document.documentElement.getAttribute("data-theme");
      setTheme(dataTheme === "dark" ? "dark" : "light");
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      mo.disconnect();
    };
  }, []);

  // 检查必填字段是否都已配置
  if (PUBLIC_GISCUS_REPO && PUBLIC_GISCUS_REPO_ID) {
    return (
      <Giscus
        host={PUBLIC_GISCUS_HOST || "https://giscus.app"}
        repo={PUBLIC_GISCUS_REPO as `${string}/${string}`}
        repoId={PUBLIC_GISCUS_REPO_ID}
        category={PUBLIC_GISCUS_CATEGORY}
        categoryId={PUBLIC_GISCUS_CATEGORY_ID}
        mapping="pathname"
        strict="0"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="bottom"
        theme={theme}
        loading="lazy"
        lang={PUBLIC_GISCUS_LANG || "zh-CN"}
      />
    );
  }

  return (
    <div className="mt-8 rounded-lg border border-gray-300 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-800">
      <p className="text-center text-gray-600 dark:text-gray-400">
        评论功能需要配置 Giscus 参数。请在环境变量中设置：
        <br />
        <code className="rounded bg-gray-200 px-1 text-sm dark:bg-gray-700">
          PUBLIC_GISCUS_REPO, PUBLIC_GISCUS_REPO_ID
        </code>
      </p>
    </div>
  );
}
