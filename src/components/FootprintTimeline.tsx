import { useEffect, useMemo, useRef, useState } from "react";

type TimelineLocation = {
  id: string;
  visitedAt: string;
};

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
  locations: TimelineLocation[];
  timezone: string;
};

const PAGE_SIZE = 8;

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

const getPageFromUrl = (totalPages: number) => {
  if (typeof window === "undefined") return 1;
  const value = Number(
    new URL(window.location.href).searchParams.get("footprints-page")
  );
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), totalPages) : 1;
};

export default function FootprintTimeline({ locations, timezone }: Props) {
  const totalPages = Math.max(1, Math.ceil(locations.length / PAGE_SIZE));
  const [page, setPage] = useState(() => getPageFromUrl(totalPages));
  const [records, setRecords] = useState<FootprintRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const pageLocations = useMemo(
    () => locations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [locations, page]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    Promise.all(
      pageLocations.map(async location => {
        const response = await fetch(
          `/api/footprints/${encodeURIComponent(location.id)}.json`,
          { cache: "force-cache", signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Failed to load ${location.id}`);
        return (await response.json()) as FootprintRecord;
      })
    )
      .then(setRecords)
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
  }, [pageLocations]);

  useEffect(() => {
    if (loading || error || !listRef.current) return;

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
  }, [records, loading, error]);

  const changePage = (nextPage: number) => {
    const normalizedPage = Math.min(Math.max(nextPage, 1), totalPages);
    const url = new URL(window.location.href);
    if (normalizedPage === 1) url.searchParams.delete("footprints-page");
    else url.searchParams.set("footprints-page", String(normalizedPage));
    window.history.pushState({}, "", url);
    setPage(normalizedPage);
    document
      .querySelector("#footprints-timeline")
      ?.scrollIntoView({ behavior: "smooth" });
  };

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
    <div
      className="footprints-timeline-content"
      aria-live="polite"
      aria-busy={loading}
    >
      {loading ? (
        <p className="footprints-timeline-status">正在加载足迹…</p>
      ) : null}
      {error ? (
        <p className="footprints-timeline-status">足迹加载失败，请稍后重试。</p>
      ) : null}

      {!loading && !error ? (
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
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {totalPages > 1 ? (
        <nav className="footprints-pagination" aria-label="足迹分页">
          <button
            type="button"
            onClick={() => changePage(page - 1)}
            disabled={page === 1}
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页
          </span>
          <button
            type="button"
            onClick={() => changePage(page + 1)}
            disabled={page === totalPages}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </div>
  );
}
