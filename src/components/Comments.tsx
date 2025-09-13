import Giscus from '@giscus/react';
import { SITE } from "@/config";

export default function Comments () {
  return (
    <Giscus
      repo={SITE.comments.giscus.repo}
      repoId={SITE.comments.giscus.repoId}
      category={SITE.comments.giscus.category}
      categoryId={SITE.comments.giscus.categoryId}
      mapping="pathname"
      strict="0"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="bottom"
      theme="preferred_color_scheme"
      loading="lazy"
      lang={SITE.comments.giscus.lang ?? "zh-CN"}
    />
  );
}