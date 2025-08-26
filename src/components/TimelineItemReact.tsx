import React, { useEffect, useRef, useState } from "react";
import MediaCard from "./MediaCard";

// 导入 lightgallery 样式
import "lightgallery/css/lightgallery.css";
import "lightgallery/css/lg-zoom.css";

// 本地电影数据接口
interface LocalMovieData {
  id?: number;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  runtime?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  source?: string;
  external_url?: string;
}

// 本地TV数据接口
interface LocalTVData {
  id?: string;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  source?: string;
  external_url?: string;
}

// 本地书籍数据接口
interface LocalBookData {
  id?: string;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  external_url?: string;
}

// 本地音乐数据接口
interface LocalMusicData {
  id?: string;
  title: string;
  author?: string;
  album?: string;
  release_date?: string;
  rating?: number;
  duration?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  url?: string;
}

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
  movieData?: LocalMovieData;
  tvData?: LocalTVData;
  bookData?: LocalBookData;
  musicData?: LocalMusicData;
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
    <div className="diary-item mb-6 border-b border-dashed border-border/30 pb-6 last:border-b-0 last:pb-0">
      <div className="content group transition-all duration-300">
        {/* 时间和内容整合显示 */}
        <div className="flex items-start gap-3">
          {/* 时间标签 - 使用h3标题以便Pagefind识别为子结果 */}
          <h3
            id={date ? `diary-${date}-${time.replace(/:/g, "-")}` : undefined}
            className="text-skin-base/60 m-0 flex-shrink-0 pr-2 pl-0 text-base font-medium"
          >
            <span className="hidden">{date}</span>
            {` ${time}`}
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
                <div className="images-grid mb-4" ref={galleryRef}>
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
                          className={`lg-item group block overflow-hidden rounded-xl ${
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
                        >
                          <img
                            src={optimizedImg.thumbnail}
                            alt={originalImg.alt}
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
                          />
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {htmlContent && (
                <div
                  className="html-content mt-0 mb-4 max-w-none leading-[0]"
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                  suppressHydrationWarning={true}
                />
              )}

              {movieData && (
                <div className="movie-card-container mb-4">
                  <MediaCard
                    mediaData={{
                      ...movieData,
                    }}
                  />
                </div>
              )}

              {tvData && (
                <div className="tv-card-container mb-4">
                  <MediaCard
                    mediaData={{
                      ...tvData,
                    }}
                    cardType="tv"
                  />
                </div>
              )}

              {bookData && (
                <div className="book-card-container mb-4">
                  <MediaCard
                    mediaData={{
                      ...bookData,
                    }}
                    cardType="book"
                  />
                </div>
              )}

              {musicData && (
                <div className="music-card-container mb-4">
                  <MediaCard
                    mediaData={{
                      ...musicData,
                    }}
                    cardType="music"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelineItemReact;
