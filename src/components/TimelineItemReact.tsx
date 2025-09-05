import React, { useEffect, useRef, useState } from "react";
import MediaCard from "./MediaCard";
import type { MediaCardData } from "../types/media";

// 导入 lightgallery 样式
import "lightgallery/css/lightgallery.css";
import "lightgallery/css/lg-zoom.css";

export interface TimelineItemProps {
  time: string;
  date?: string;
  text?: string;
  images?: Array<{
    alt: string;
    src: string;
    title?: string;
    original?: string;
    width?: number;
    height?: number;
  }>;
  htmlContent?: string;
  movieData?: MediaCardData;
  tvData?: MediaCardData;
  bookData?: MediaCardData;
  musicData?: MediaCardData;
}

const TimelineItemReact: React.FC<TimelineItemProps> = ({
  time,
  date,
  text,
  images,
  htmlContent,
  movieData,
  tvData,
  bookData,
  musicData,
}) => {
  const galleryRef = useRef<HTMLDivElement>(null);
  const lightGalleryRef = useRef<{ destroy: () => void } | null>(null);
  const [optimizedImages, setOptimizedImages] = useState<
    {
      thumbnail: string;
      original: string;
      width?: number;
      height?: number;
    }[]
  >([]);
  const [isImagesLoaded, setIsImagesLoaded] = useState(false);

  // 优化图片
  useEffect(() => {
    if (images && images.length > 0) {
      const optimizeAllImages = async () => {
        const optimizedResults = images.map(img => {
          // 如果图片数据中已经包含宽高信息，直接使用
          if (img.width && img.height) {
            return {
              thumbnail: img.src,
              original: img.original || img.src,
              width: img.width,
              height: img.height,
            };
          }
          // 否则使用默认尺寸信息
          return {
            thumbnail: img.src,
            original: img.original || img.src,
            width: 800,
            height: 600,
          };
        });
        setOptimizedImages(optimizedResults);
        setIsImagesLoaded(true);
      };
      optimizeAllImages();
    }
  }, [images]);

  // 初始化 lightgallery（依赖于图片优化完成）
  useEffect(() => {
    if (isImagesLoaded && optimizedImages.length > 0 && galleryRef.current) {
      // 使用动态导入来避免 ES 模块问题
      const initLightGallery = async () => {
        try {
          const { default: lightGallery } = await import("lightgallery");
          const { default: lgZoom } = await import("lightgallery/plugins/zoom");

          // 初始化 lightgallery
          lightGalleryRef.current = lightGallery(galleryRef.current!, {
            plugins: [lgZoom],
            speed: 400,
            selector: "a.lg-item",
            download: false,
            counter: false,
            getCaptionFromTitleOrAlt: false,
            mode: "lg-fade",
            hideBarsDelay: 2000,
            showZoomInOutIcons: true,
            actualSize: false,
            enableDrag: true,
            enableSwipe: true,
            zoomFromOrigin: true,
            allowMediaOverlap: false,
          });
        } catch {
          // Failed to load lightGallery - silently handle the error
        }
      };

      initLightGallery();
    }

    return () => {
      if (lightGalleryRef.current) {
        lightGalleryRef.current.destroy();
      }
    };
  }, [isImagesLoaded, optimizedImages]);
  return (
    <article className="diary-item mb-6 border-b border-dashed border-border/30 pb-6 last:border-b-0 last:pb-0">
      <div className="content group transition-all duration-300">
        {/* 时间和内容整合显示 */}
        <div className="flex items-start gap-3">
          {/* 时间标签 - 使用h3标题以便Pagefind识别为子结果 */}
          <h3
            id={date ? `diary-${date}-${time.replace(/:/g, "-")}` : undefined}
            className="text-skin-base/60 m-0 flex-shrink-0 pr-2 pl-0 text-base font-medium"
            aria-label={`${time} 时间段的记录`}
          >
            <span className="sr-only">{date}</span>
            <time dateTime={date ? `${date}T${time}` : time}>{time}</time>
          </h3>
          {/* 内容区域 */}
          <div className="min-w-0 flex-1">
            {/* 帖子内容 */}
            <div className="text-skin-base">
              {text && (
                <div
                  className="mb-4 text-base leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: text }}
                />
              )}

              {isImagesLoaded && optimizedImages.length > 0 && (
                <figure
                  className="images-grid mb-4"
                  ref={galleryRef}
                  role="group"
                  aria-label={`图片集合，共 ${optimizedImages.length} 张图片`}
                >
                  <div
                    className={`grid gap-3 ${
                      htmlContent
                        ? "w-full grid-cols-1"
                        : optimizedImages.length === 1
                          ? "max-w-80 grid-cols-1"
                          : optimizedImages.length === 2
                            ? "max-w-83 grid-cols-2"
                            : optimizedImages.length === 4
                              ? "max-w-83 grid-cols-2"
                              : "max-w-126 grid-cols-3"
                    }`}
                  >
                    {optimizedImages.map((optimizedImg, index) => {
                      const originalImg = images![index];

                      return (
                        <a
                          key={index}
                          className={`lg-item group focus:ring-skin-accent block overflow-hidden rounded-xl focus:ring-2 focus:ring-offset-2 focus:outline-none ${
                            optimizedImages.length === 1
                              ? "relative"
                              : "image-item relative aspect-square"
                          }`}
                          style={
                            optimizedImages.length === 1
                              ? {}
                              : ({
                                  aspectRatio: "1 / 1",
                                  WebkitAspectRatio: "1 / 1",
                                } as React.CSSProperties)
                          }
                          data-src={optimizedImg.original}
                          data-lg-size={`${optimizedImg.width}-${optimizedImg.height}`}
                          data-sub-html={`<h4>${originalImg.alt}</h4><p>${originalImg.title || `${originalImg.width}x${optimizedImg.height}`}</p>`}
                          href={optimizedImg.original}
                          aria-label={`查看大图：${originalImg.alt}${originalImg.title ? ` - ${originalImg.title}` : ""}`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.currentTarget.click();
                            }
                          }}
                        >
                          <img
                            src={optimizedImg.thumbnail}
                            alt={originalImg.alt || `图片 ${index + 1}`}
                            className="h-full w-full cursor-pointer object-cover transition-transform duration-300 hover:scale-105"
                            style={
                              optimizedImages.length === 1
                                ? {}
                                : {
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  }
                            }
                            loading="lazy"
                            title={originalImg.title}
                          />
                        </a>
                      );
                    })}
                  </div>
                  {optimizedImages.length > 1 && (
                    <figcaption className="sr-only">
                      图片集合包含 {optimizedImages.length}{" "}
                      张图片，点击任意图片可查看大图
                    </figcaption>
                  )}
                </figure>
              )}

              {htmlContent && (
                <div
                  className="html-content mt-0 mb-4 max-w-none leading-[0]"
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                  suppressHydrationWarning={true}
                  role="region"
                  aria-label="富文本内容"
                />
              )}

              {movieData && (
                <section
                  className="movie-card-container mb-4 px-0"
                  aria-label="电影信息"
                >
                  <MediaCard mediaData={movieData} cardType="movie" />
                </section>
              )}

              {tvData && (
                <section
                  className="tv-card-container mb-4 px-0"
                  aria-label="电视剧信息"
                >
                  <MediaCard mediaData={tvData} cardType="tv" />
                </section>
              )}

              {bookData && (
                <section
                  className="book-card-container mb-4 px-0"
                  aria-label="书籍信息"
                >
                  <MediaCard mediaData={bookData} cardType="book" />
                </section>
              )}

              {musicData && (
                <section
                  className="music-card-container mb-4 px-0"
                  aria-label="音乐信息"
                >
                  <MediaCard mediaData={musicData} cardType="music" />
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

export default TimelineItemReact;
