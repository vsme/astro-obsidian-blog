import { useEffect, useMemo, useRef, useState } from "react";

type FootprintPhoto = {
  thumbnail: string;
  original: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  position?: string;
};

type FootprintRecord = {
  id: string;
  visitedAt: string;
  country: string;
  region: string;
  city: string;
  place: string;
  note: string;
  photos: FootprintPhoto[];
  relatedPosts: Array<{ id: string; title: string; href: string }>;
};

type Props = {
  totalItems: number;
  pageSize: number;
  timezone: string;
};

type FootprintTimelinePageResponse = {
  records: FootprintRecord[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasMore: boolean;
    itemsPerPage: number;
  };
};

const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] || character
  );

const getGalleryCaption = (photo: FootprintPhoto) =>
  `<div class="footprint-gallery-caption"><h4>${escapeHTML(photo.alt)}</h4>${
    photo.caption ? `<p>${escapeHTML(photo.caption)}</p>` : ""
  }</div>`;

export default function FootprintTimeline({
  totalItems,
  pageSize,
  timezone,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<FootprintRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    fetch(`/api/footprints/timeline/${page}.json`, {
      cache: "force-cache",
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Failed to load footprint timeline page ${page}`);
        }
        return (await response.json()) as FootprintTimelinePageResponse;
      })
      .then(({ records: nextRecords }) => {
        setRecords(currentRecords =>
          page === 1 ? nextRecords : [...currentRecords, ...nextRecords]
        );
      })
      .catch(fetchError => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        )
          return;
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, retryToken]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || loading || error || page >= totalPages) return;

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        setPage(currentPage => Math.min(currentPage + 1, totalPages));
      },
      { rootMargin: "300px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, loading, page, totalPages]);

  useEffect(() => {
    if (!records.length || !listRef.current) return;

    let disposed = false;
    const instances: Array<{ destroy: () => number }> = [];

    Promise.all([
      import("lightgallery"),
      import("lightgallery/plugins/zoom"),
      import("lightgallery/plugins/thumbnail"),
    ]).then(
      ([
        { default: lightGallery },
        { default: lgZoom },
        { default: lgThumbnail },
      ]) => {
        if (disposed || !listRef.current) return;
        listRef.current
          .querySelectorAll<HTMLElement>(".footprints-timeline-photos")
          .forEach(gallery => {
            instances.push(
              lightGallery(gallery, {
                plugins: [lgZoom, lgThumbnail],
                selector: ".footprints-timeline-photo",
                speed: 350,
                download: false,
                counter: true,
                actualSize: false,
                getCaptionFromTitleOrAlt: false,
                thumbnail: true,
                animateThumb: true,
              })
            );
          });
      }
    );

    return () => {
      disposed = true;
      instances.forEach(instance => instance.destroy());
    };
  }, [records]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: timezone,
      }),
    [timezone]
  );
  const weekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        weekday: "short",
        timeZone: timezone,
      }),
    [timezone]
  );

  return (
    <div className="footprints-timeline-content" aria-busy={loading}>
      {loading && records.length === 0 ? (
        <p className="footprints-timeline-status">正在加载足迹…</p>
      ) : null}
      {error && records.length === 0 ? (
        <div className="footprints-timeline-status">
          <button
            type="button"
            onClick={() => setRetryToken(value => value + 1)}
          >
            加载失败，点击重试
          </button>
        </div>
      ) : null}

      {records.length ? (
        <div className="footprints-timeline-list" ref={listRef}>
          {records.map(record => (
            <article className="footprints-timeline-item" key={record.id}>
              <div className="footprints-timeline-card">
                <header>
                  <time dateTime={record.visitedAt}>
                    {dateFormatter.format(new Date(record.visitedAt))}{" "}
                    {weekdayFormatter.format(new Date(record.visitedAt))}
                  </time>
                  <p>
                    {[record.country, record.region, record.city, record.place]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </header>

                {record.note ? (
                  <p className="footprints-timeline-note">{record.note}</p>
                ) : null}
                {record.relatedPosts.length ? (
                  <nav
                    aria-label={`${record.place}的相关文章`}
                    className="footprints-timeline-related"
                  >
                    {record.relatedPosts.map(post => (
                      <a
                        href={post.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        key={post.id}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 3h8l4 4v14H6z" />
                          <path d="M14 3v5h4M9 13h6M9 17h5" />
                        </svg>
                        <span>{post.title}</span>
                        <span
                          className="footprints-timeline-related-arrow"
                          aria-hidden="true"
                        >
                          ↗
                        </span>
                      </a>
                    ))}
                  </nav>
                ) : null}

                <div
                  className="footprints-timeline-photos"
                  data-count={Math.min(record.photos.length, 4)}
                >
                  {record.photos.map(photo => (
                    <a
                      href={photo.original}
                      className="footprints-timeline-photo"
                      data-src={photo.original}
                      data-lg-size={`${photo.width}-${photo.height}`}
                      data-sub-html={getGalleryCaption(photo)}
                      key={photo.original}
                      aria-label={`查看大图：${photo.alt}`}
                    >
                      <img
                        src={photo.thumbnail}
                        alt={photo.alt}
                        width={photo.width}
                        height={photo.height}
                        loading="lazy"
                        decoding="async"
                        style={{ objectPosition: photo.position || "center" }}
                      />
                      {photo.caption ? <span>{photo.caption}</span> : null}
                    </a>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div
        className="footprints-infinite-sentinel"
        ref={loadMoreRef}
        role="status"
        aria-live="polite"
      >
        {loading && records.length ? (
          <span className="footprints-infinite-loading">正在加载更多足迹…</span>
        ) : null}
        {error && records.length ? (
          <button
            type="button"
            onClick={() => setRetryToken(value => value + 1)}
          >
            加载失败，点击重试
          </button>
        ) : null}
        {!loading && !error && records.length && page >= totalPages ? (
          <span>已展示全部 {records.length} 条足迹</span>
        ) : null}
      </div>
    </div>
  );
}
