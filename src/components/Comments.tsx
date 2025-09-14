import { useEffect, useState } from "react";
import Giscus from "@giscus/react";
import { SITE } from "@/config";

function detectTheme (): "light" | "dark" | "preferred_color_scheme" {
  if (typeof window === "undefined") return "preferred_color_scheme";
  const dataTheme = document.documentElement.getAttribute("data-theme");
  if (dataTheme === "dark" || dataTheme === "light") return dataTheme;
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Comments () {
  const [theme, setTheme] = useState<"light" | "dark" | "preferred_color_scheme">(detectTheme());

  // 跟随站内切换
  useEffect(() => {
    // 站内按钮会切换 theme，用 MO 监听
    const mo = new MutationObserver(() => {
      const dataTheme = document.documentElement.getAttribute("data-theme");
      setTheme(dataTheme === "dark" ? "dark" : "light");
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      mo.disconnect();
    };
  }, []);
  return (
    <Giscus
      host={SITE.comments.giscus.host}
      repo={SITE.comments.giscus.repo}
      repoId={SITE.comments.giscus.repoId}
      category={SITE.comments.giscus.category}
      categoryId={SITE.comments.giscus.categoryId}
      mapping="pathname"
      strict="0"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="bottom"
      theme={theme}
      loading="lazy"
      lang={SITE.comments.giscus.lang ?? "zh-CN"}
    />
  );
}