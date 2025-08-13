import React from "react";

export interface MediaData {
  id?: number | string;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  runtime?: number;
  genres?: string;
  overview?: string;
  poster_path?: string;
  author?: string;
  album?: string;
  duration?: number;
  url?: string;
  source?: string;
  external_url?: string;
}

export interface MediaCardProps {
  mediaData: MediaData;
  theme?: "light" | "dark";
  cardType?: "movie" | "tv" | "book" | "music";
}

const MediaCard: React.FC<MediaCardProps> = ({
  mediaData,
  theme = "light",
  cardType = "movie",
}) => {
  const {
    id,
    title,
    release_date,
    region,
    rating,
    runtime,
    genres,
    overview,
    poster_path,
    author,
    album,
    duration,
    url,
    source,
    external_url,
  } = mediaData;

  const posterUrl = poster_path || "";
  const mediaRating = rating ? Math.round(rating * 10) / 10 : 0;



  const formatRuntime = (minutes?: number) => {
    if (!minutes) return "";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatReleaseDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const handleCardClick = () => {
    if (cardType === "music" && url) {
      window.open(url, "_blank");
    } else if (external_url) {
      // 如果有external_url，优先使用
      window.open(external_url, "_blank");
    } else if (id) {
      let baseUrl;
      if (cardType === "tv") {
        // 根据source决定TV剧集的链接
        if (source === "douban") {
          baseUrl = "https://movie.douban.com/subject/";
        } else {
          baseUrl = "https://www.themoviedb.org/tv/";
        }
      } else if (cardType === "book") {
        baseUrl = "https://book.douban.com/subject/";
      } else {
        // 电影类型，根据source决定链接
        if (source === "douban") {
          baseUrl = "https://movie.douban.com/subject/";
        } else {
          baseUrl = "https://www.themoviedb.org/movie/";
        }
      }
      window.open(`${baseUrl}${id}`, "_blank");
    }
  };

  return (
    <div
      className={`media-card ${theme === "dark" ? "dark" : "light"} w-full max-w-3xl cursor-pointer rounded-lg transition-all duration-300 bg-muted/20 hover:bg-muted/30`}
      onClick={handleCardClick}
    >
      <div className="flex flex-col gap-3 p-3 sm:flex-row">
        {/* 海报图片 - 左侧 */}
        {posterUrl && (
          <div className="mx-auto w-24 flex-shrink-0 sm:mx-0 relative">
            <img
              src={posterUrl}
              alt={title}
              className={`w-full rounded-md object-cover shadow-sm ${
                cardType === "music" ? "aspect-square" : "aspect-[2/3]"
              }`}
            />

          </div>
        )}

        {/* 媒体信息 - 右侧 */}
        <div className="flex-1">
          {/* 标题和评分 */}
          <div className="mb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 text-center sm:text-left">
              <div className="mb-2">
                <h3 className="leading-tight font-bold text-skin-accent text-lg sm:text-xl">
                  {title}
                </h3>
              </div>

              <div className="mb-2 flex items-center justify-center gap-2 text-xs sm:mb-0 sm:justify-start sm:text-sm text-skin-base/60">
                {cardType === "music" ? (
                  <>
                    {author && <span>{author}</span>}
                    {album && <span>• {album}</span>}
                    {duration && <span>• {formatDuration(duration)}</span>}
                  </>
                ) : (
                  <>
                    {release_date && (
                      <span>
                        {formatReleaseDate(release_date)}
                        {(cardType === 'book' ? author : region) && ` (${cardType === 'book' ? author : region})`}
                      </span>
                    )}
                    {runtime && <span>• {formatRuntime(runtime)}</span>}
                  </>
                )}
              </div>
            </div>

            {/* 类型徽标和评分 */}
            <div className="flex flex-col items-center gap-2 sm:mt-0 sm:items-end">
              {/* 类型徽标 */}
              {/* <div className="flex items-center">
                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-skin-card-muted text-skin-base rounded-full border border-skin-line">
                  <span>{typeBadge.icon}</span>
                  <span>{typeBadge.label}</span>
                </span>
              </div> */}

              {/* 评分 */}
              {mediaRating > 0 && cardType !== 'music' && (
                <div className="flex items-center gap-1">
                  <div className="flex items-center">
                    {Array.from({ length: 5 }, (_, star) => {
                      const starRating = mediaRating / 2;
                      const isFull = star < Math.floor(starRating);
                      const isHalf =
                        star === Math.floor(starRating) &&
                        starRating % 1 >= 0.5;

                      return (
                        <div key={star} className="relative h-3 w-3">
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 20 20"
                            fill="none"
                          >
                            <defs>
                              <clipPath id={`half-star-${star}`}>
                                <rect x="0" y="0" width="10" height="20" />
                              </clipPath>
                            </defs>

                            {/* 背景星星（灰色） */}
                            <path
                              d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                              fill="#d1d5db"
                            />

                            {/* 满星或半星 */}
                            {isFull && (
                              <path
                                d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                                fill="#fbbf24"
                              />
                            )}

                            {/* 半星（使用SVG clipPath） */}
                            {isHalf && (
                              <path
                                d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                                fill="#fbbf24"
                                clipPath={`url(#half-star-${star})`}
                              />
                            )}
                          </svg>
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-sm font-semibold text-skin-accent">
                    {mediaRating.toFixed(1)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 类型标签 */}
          <div className="mb-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {genres &&
              genres.split(",").map((genre, index) => (
                <span
                  key={index}
                  className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
                >
                  {genre.trim()}
                </span>
              ))}
          </div>

          {/* 简介 */}
          {overview && cardType !== 'music' && (
            <div className="mb-2">
              <p
                className="text-skin-base/80 line-clamp-3 text-center text-xs leading-relaxed sm:line-clamp-2 sm:text-left sm:text-sm"
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {overview}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaCard;
