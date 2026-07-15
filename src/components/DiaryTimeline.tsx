import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import DiaryEntryReact, { type TimeBlock } from "./DiaryEntryReact";

export interface ParsedEntry {
  date: string;
  timeBlocks: TimeBlock[];
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  itemsPerPage: number;
}

export interface ArchiveMonth {
  value: string;
  label: string;
  targetDate: string;
  page: number;
}

export interface ArchiveGroup {
  year: string;
  months: ArchiveMonth[];
}

export interface DiaryTimelineProps {
  initialEntries: ParsedEntry[];
  paginationInfo: PaginationInfo;
  archiveGroups?: ArchiveGroup[];
  hideYear?: boolean;
  riverMode?: boolean;
}

type CategoryFilter = "all" | "daily" | "reading" | "watching" | "music";

interface CategoryState {
  entries: ParsedEntry[];
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  initialized: boolean;
}

type CategoryStates = Record<CategoryFilter, CategoryState>;

interface DiaryPageResponse {
  entries: ParsedEntry[];
  pagination: PaginationInfo;
}

const CATEGORY_OPTIONS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "daily", label: "日常" },
  { value: "reading", label: "阅读" },
  { value: "watching", label: "观影" },
  { value: "music", label: "音乐" },
];

const DiaryTimeline: React.FC<DiaryTimelineProps> = ({
  initialEntries = [],
  paginationInfo = {
    currentPage: 1,
    totalPages: 1,
    hasMore: false,
    itemsPerPage: 5,
  },
  archiveGroups = [],
  hideYear = false,
  riverMode = false,
}) => {
  const initialCategoryStates: CategoryStates = {
    all: {
      entries: initialEntries || [],
      currentPage: paginationInfo?.currentPage || 1,
      totalPages: paginationInfo?.totalPages || 1,
      hasMore: paginationInfo?.hasMore || false,
      initialized: true,
    },
    daily: {
      entries: [],
      currentPage: 0,
      totalPages: 0,
      hasMore: false,
      initialized: false,
    },
    reading: {
      entries: [],
      currentPage: 0,
      totalPages: 0,
      hasMore: false,
      initialized: false,
    },
    watching: {
      entries: [],
      currentPage: 0,
      totalPages: 0,
      hasMore: false,
      initialized: false,
    },
    music: {
      entries: [],
      currentPage: 0,
      totalPages: 0,
      hasMore: false,
      initialized: false,
    },
  };
  const [categoryStates, setCategoryStates] = useState<CategoryStates>(
    initialCategoryStates
  );
  const [isLoading, setIsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [activePeriod, setActivePeriod] = useState(
    archiveGroups[0]?.months[0]?.value ?? ""
  );
  const [activeJumpTarget, setActiveJumpTarget] = useState<string | null>(null);
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);

  const isLoadingRef = useRef(false);
  const loadingCountRef = useRef(0);
  const categoryStatesRef = useRef<CategoryStates>(initialCategoryStates);
  const targetAlignmentFrameRef = useRef<number | null>(null);
  const targetAlignmentTimeoutRef = useRef<number | null>(null);
  const pendingCategoryRef = useRef<CategoryFilter>("all");
  const requestRef = useRef<Map<string, Promise<DiaryPageResponse>>>(new Map());
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const filterOptionsRef = useRef<HTMLDivElement>(null);
  const filterIndicatorRef = useRef<HTMLSpanElement>(null);
  const periodPickerRef = useRef<HTMLDivElement>(null);
  const periodTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const startLoading = useCallback(() => {
    loadingCountRef.current += 1;
    isLoadingRef.current = true;
    setIsLoading(true);
  }, []);

  const finishLoading = useCallback(() => {
    loadingCountRef.current = Math.max(loadingCountRef.current - 1, 0);
    const stillLoading = loadingCountRef.current > 0;
    isLoadingRef.current = stillLoading;
    setIsLoading(stillLoading);
  }, []);

  useEffect(() => {
    if (!isPeriodMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!periodPickerRef.current?.contains(event.target as Node)) {
        setIsPeriodMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPeriodMenuOpen(false);
        periodTriggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isPeriodMenuOpen]);

  useLayoutEffect(() => {
    const options = filterOptionsRef.current;
    const indicator = filterIndicatorRef.current;
    if (!options || !indicator) return;

    const updateIndicator = () => {
      const activeButton = options.querySelector<HTMLButtonElement>(
        `[data-category="${activeCategory}"]`
      );
      if (!activeButton) return;

      indicator.style.width = `${activeButton.offsetWidth}px`;
      indicator.style.transform = `translate3d(${activeButton.offsetLeft}px, 0, 0)`;
      indicator.style.opacity = "1";
    };

    updateIndicator();
    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(options);
    return () => resizeObserver.disconnect();
  }, [activeCategory]);

  const updateCategoryState = useCallback(
    (
      category: CategoryFilter,
      update: (state: CategoryState) => CategoryState
    ) => {
      setCategoryStates(previous => {
        const next = {
          ...previous,
          [category]: update(previous[category]),
        };
        categoryStatesRef.current = next;
        return next;
      });
    },
    []
  );

  const fetchPage = useCallback((category: CategoryFilter, page: number) => {
    const requestKey = `${category}-${page}`;
    const existingRequest = requestRef.current.get(requestKey);
    if (existingRequest) return existingRequest;

    const url =
      category === "all"
        ? `/api/diary/${page}.json`
        : `/api/diary/category/${category}/${page}.json`;
    const request = fetch(url)
      .then(async response => {
        if (!response.ok) throw new Error("Failed to fetch diary entries");
        return (await response.json()) as DiaryPageResponse;
      })
      .finally(() => requestRef.current.delete(requestKey));

    requestRef.current.set(requestKey, request);
    return request;
  }, []);

  const loadThroughPage = useCallback(
    async (category: CategoryFilter, targetPage: number) => {
      const categoryState = categoryStatesRef.current[category];
      const lastPage = Math.min(targetPage, categoryState.totalPages);
      const firstPage = categoryState.currentPage + 1;
      if (firstPage > lastPage) return true;

      startLoading();

      try {
        const pages = Array.from(
          { length: lastPage - firstPage + 1 },
          (_, index) => firstPage + index
        );
        const results = await Promise.all(
          pages.map(page => fetchPage(category, page))
        );
        const entries = results.flatMap(result => result.entries);

        updateCategoryState(category, previous => {
          const knownDates = new Set(previous.entries.map(entry => entry.date));
          return {
            ...previous,
            entries: [
              ...previous.entries,
              ...entries.filter(entry => !knownDates.has(entry.date)),
            ],
            currentPage: lastPage,
            hasMore: lastPage < previous.totalPages,
            initialized: true,
          };
        });
        return true;
      } catch (error) {
        console.error("Error loading more entries:", error);
        return false;
      } finally {
        finishLoading();
      }
    },
    [fetchPage, finishLoading, startLoading, updateCategoryState]
  );

  const loadMore = useCallback(async () => {
    const activeState = categoryStatesRef.current[activeCategory];
    if (isLoadingRef.current || !activeState.hasMore) return;
    await loadThroughPage(activeCategory, activeState.currentPage + 1);
  }, [activeCategory, loadThroughPage]);

  const activeState = categoryStates[activeCategory];
  const displayedEntries = activeState.entries;
  const hasMore = activeState.hasMore;

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "0px 0px 600px 0px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const commitCategoryTransition = useCallback(
    (category: CategoryFilter, nextCategoryState?: CategoryState) => {
      const commit = () => {
        if (nextCategoryState) {
          setCategoryStates(previous => {
            const next = {
              ...previous,
              [category]: nextCategoryState,
            };
            categoryStatesRef.current = next;
            return next;
          });
        }
        setActiveCategory(category);
      };

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      if (reduceMotion) {
        commit();
        return;
      }

      const previousRects = new Map(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            "#diary-feed > article[data-diary-date]"
          )
        ).map(entry => [
          entry.dataset.diaryDate ?? "",
          entry.getBoundingClientRect(),
        ])
      );

      flushSync(commit);

      requestAnimationFrame(() => {
        const entries = Array.from(
          document.querySelectorAll<HTMLElement>(
            "#diary-feed > article[data-diary-date]"
          )
        );

        entries.forEach(entry => {
          const previousRect = previousRects.get(
            entry.dataset.diaryDate ?? ""
          );
          if (!previousRect) return;

          const currentRect = entry.getBoundingClientRect();
          const offsetX = previousRect.left - currentRect.left;
          const offsetY = previousRect.top - currentRect.top;
          if (Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1) return;

          const content =
            entry.querySelector<HTMLElement>(":scope > .date-group");
          if (!content) return;
          content.style.setProperty("--diary-flip-x", `${offsetX}px`);
          content.style.setProperty("--diary-flip-y", `${offsetY}px`);
          content.classList.add("diary-category-flip");
        });

        window.setTimeout(() => {
          entries.forEach(entry => {
            const content =
              entry.querySelector<HTMLElement>(":scope > .date-group");
            content?.classList.remove("diary-category-flip");
            content?.style.removeProperty("--diary-flip-x");
            content?.style.removeProperty("--diary-flip-y");
          });
        }, 360);
      });
    },
    []
  );

  const isToolbarPinned = useCallback(() => {
    const toolbar = document.querySelector<HTMLElement>(".diary-toolbar");
    if (!toolbar) return false;

    const stickyTop = Number.parseFloat(getComputedStyle(toolbar).top);
    return toolbar.getBoundingClientRect().top <= stickyTop + 1;
  }, []);

  const alignFeedStartBelowToolbar = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById("diary-feed")?.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "start",
        });
      });
    });
  }, []);

  const cancelTargetAlignment = useCallback(() => {
    if (targetAlignmentFrameRef.current !== null) {
      cancelAnimationFrame(targetAlignmentFrameRef.current);
      targetAlignmentFrameRef.current = null;
    }
    if (targetAlignmentTimeoutRef.current !== null) {
      window.clearTimeout(targetAlignmentTimeoutRef.current);
      targetAlignmentTimeoutRef.current = null;
    }
  }, []);

  const alignTargetBelowToolbar = useCallback(
    (targetDate: string) => {
      cancelTargetAlignment();

      const align = () => {
        const target = document.getElementById(`entry-${targetDate}`);
        if (!target) return;

        const documentTop = target.getBoundingClientRect().top + window.scrollY;
        const scrollMarginTop = Number.parseFloat(
          getComputedStyle(target).scrollMarginTop
        );
        const rootFontSize = Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize
        );
        const targetTop =
          (Number.isFinite(scrollMarginTop) ? scrollMarginTop : 0) +
          (Number.isFinite(rootFontSize) ? rootFontSize * 1.5 : 24);
        window.scrollTo({
          top: documentTop - targetTop,
          behavior: "instant" as ScrollBehavior,
        });

        // A long jump can synchronously change the height of content above the
        // target (for example when lazy media enters the viewport). Correct it
        // in the same frame so only the final position is ever painted.
        const synchronousDrift = target.getBoundingClientRect().top - targetTop;
        if (Math.abs(synchronousDrift) > 1) {
          window.scrollTo({
            top: window.scrollY + synchronousDrift,
            behavior: "instant" as ScrollBehavior,
          });
        }
      };

      // Let newly mounted media cards finish their first layout before the
      // only visible scroll, avoiding an overshoot followed by a correction.
      targetAlignmentTimeoutRef.current = window.setTimeout(() => {
        targetAlignmentTimeoutRef.current = null;
        targetAlignmentFrameRef.current = requestAnimationFrame(() => {
          targetAlignmentFrameRef.current = requestAnimationFrame(() => {
            targetAlignmentFrameRef.current = null;
            align();
          });
        });
      }, 320);
    },
    [cancelTargetAlignment]
  );

  useEffect(() => cancelTargetAlignment, [cancelTargetAlignment]);

  const applyFilters = useCallback(
    async (category: CategoryFilter) => {
      if (category === activeCategory) return;
      setActiveJumpTarget(null);
      const keepToolbarPinned = isToolbarPinned();
      pendingCategoryRef.current = category;
      const categoryState = categoryStatesRef.current[category];
      if (categoryState.initialized) {
        commitCategoryTransition(category);
        if (keepToolbarPinned) alignFeedStartBelowToolbar();
        return;
      }

      startLoading();
      let alignAfterLoading = false;
      try {
        const result = await fetchPage(category, 1);
        const nextCategoryState: CategoryState = {
          entries: result.entries,
          currentPage: result.pagination.currentPage,
          totalPages: result.pagination.totalPages,
          hasMore: result.pagination.hasMore,
          initialized: true,
        };

        if (pendingCategoryRef.current === category) {
          commitCategoryTransition(category, nextCategoryState);
          alignAfterLoading = keepToolbarPinned;
        } else {
          updateCategoryState(category, () => nextCategoryState);
        }
      } catch (error) {
        console.error("Error loading diary category:", error);
      } finally {
        finishLoading();
      }
      if (alignAfterLoading) alignFeedStartBelowToolbar();
    },
    [
      activeCategory,
      alignFeedStartBelowToolbar,
      commitCategoryTransition,
      fetchPage,
      finishLoading,
      isToolbarPinned,
      startLoading,
      updateCategoryState,
    ]
  );

  const jumpToMonth = useCallback(
    async (month: ArchiveMonth) => {
      cancelTargetAlignment();
      setActivePeriod(month.value);
      setActiveJumpTarget(month.targetDate);
      setActiveCategory("all");
      setIsPeriodMenuOpen(false);

      const loaded = await loadThroughPage("all", month.page);
      if (loaded) alignTargetBelowToolbar(month.targetDate);
    },
    [alignTargetBelowToolbar, cancelTargetAlignment, loadThroughPage]
  );

  useEffect(() => {
    const entries = Array.from(
      document.querySelectorAll<HTMLElement>("[data-diary-date]")
    );
    if (entries.length === 0) return;

    const observer = new IntersectionObserver(
      visibleEntries => {
        const visible = visibleEntries
          .filter(entry => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          )[0];
        const date = visible?.target.getAttribute("data-diary-date");
        if (date) setActivePeriod(date.slice(0, 7));
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );

    entries.forEach(entry => observer.observe(entry));
    return () => observer.disconnect();
  }, [displayedEntries]);

  const filterDescription =
    activeCategory === "all"
      ? `显示 ${displayedEntries.length} 条已加载记录`
      : `已加载 ${displayedEntries.length} 条筛选结果`;
  const selectedMonth = archiveGroups
    .flatMap(group => group.months)
    .find(month => month.value === activePeriod);

  return (
    <div className="diary-timeline-experience">
      <div className="diary-toolbar">
        <section
          className="diary-filter-panel"
          aria-labelledby="diary-filter-heading"
        >
          <h2 id="diary-filter-heading" className="sr-only">
            按内容类型筛选时间档案
          </h2>
          <p className="sr-only" aria-live="polite">
            {filterDescription}
          </p>
          <div
            ref={filterOptionsRef}
            className="diary-filter-options"
            aria-label="按内容类型筛选"
          >
            <span
              ref={filterIndicatorRef}
              className="diary-filter-active-indicator"
              aria-hidden="true"
            />
            {CATEGORY_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                data-category={option.value}
                aria-pressed={activeCategory === option.value}
                onClick={() => void applyFilters(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {archiveGroups.length > 0 && (
          <div className="diary-period-picker" ref={periodPickerRef}>
            <button
              ref={periodTriggerRef}
              type="button"
              className="diary-period-trigger"
              aria-haspopup="dialog"
              aria-expanded={isPeriodMenuOpen}
              aria-controls="diary-period-menu"
              onClick={() => setIsPeriodMenuOpen(open => !open)}
              onKeyDown={event => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setIsPeriodMenuOpen(true);
                }
              }}
            >
              <span className="diary-period-trigger-label">时间</span>
              <span>{selectedMonth?.value.replace("-", "年")}月</span>
              <span className="diary-period-chevron" aria-hidden="true" />
            </button>

            <div
              id="diary-period-menu"
              className="diary-period-menu"
              role="dialog"
              aria-label="选择要跳转的年份和月份"
              aria-hidden={!isPeriodMenuOpen}
              data-open={isPeriodMenuOpen ? "true" : "false"}
              inert={!isPeriodMenuOpen ? true : undefined}
            >
              <div className="diary-period-menu-header">
                <strong>时间导航</strong>
                <span>最新记录在前</span>
              </div>
              <div className="diary-period-menu-content">
                {archiveGroups.map(group => (
                  <div className="diary-period-year" key={group.year}>
                    <span>{group.year}</span>
                    <div>
                      {group.months.map(month => (
                        <button
                          key={month.value}
                          type="button"
                          className={
                            activePeriod === month.value ? "is-active" : ""
                          }
                          aria-current={
                            activePeriod === month.value ? "date" : undefined
                          }
                          onClick={() => void jumpToMonth(month)}
                        >
                          {month.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        id="diary-feed"
        role="feed"
        aria-label="按时间倒序排列的日记时间线"
        aria-describedby="diary-description"
        aria-live="polite"
        aria-busy={isLoading}
      >
        {displayedEntries.map(entry => (
          <article
            id={`entry-${entry.date}`}
            data-diary-date={entry.date}
            key={entry.date}
            role="article"
            aria-labelledby={`date-${entry.date}`}
            aria-describedby={`content-${entry.date}`}
            tabIndex={0}
            className={`${riverMode ? "time-river-entry" : ""} ${activeJumpTarget === entry.date ? "is-time-jump-target" : ""} diary-feed-entry focus:ring-skin-accent focus:ring-offset-skin-fill rounded-lg focus:outline-none`}
          >
            <DiaryEntryReact
              date={entry.date}
              hideYear={hideYear}
              timeBlocks={entry.timeBlocks}
              riverMode={riverMode}
            />
          </article>
        ))}

        <div ref={loadMoreSentinelRef} className="h-px" aria-hidden="true" />

        {displayedEntries.length === 0 && !isLoading && (
          <div role="status" className="py-12 text-center">
            <p className="text-skin-base opacity-60">
              {activeCategory === "all"
                ? "还没有任何日记..."
                : "没有符合当前筛选条件的记录"}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="loading py-8 text-center" role="status">
            <p className="text-skin-base opacity-60">正在加载时间档案...</p>
          </div>
        )}

        {!hasMore && displayedEntries.length > 0 && (
          <div className="no-more py-8 text-center" role="status">
            <p className="text-skin-base opacity-60">
              {activeCategory === "all"
                ? "没有更多内容了"
                : "没有更多筛选结果了"}
            </p>
            <div className="sr-only">
              已显示全部 {displayedEntries.length} 条日记记录
            </div>
          </div>
        )}

        {hasMore && !isLoading && (
          <div className="py-8 text-center">
            <button
              onClick={loadMore}
              className="bg-skin-accent text-skin-inverted hover:bg-skin-accent/90 focus:ring-skin-accent focus:ring-offset-skin-fill rounded-lg px-6 py-3 transition-colors focus:outline-none"
              aria-describedby="load-more-description"
            >
              {activeCategory === "all" ? "加载更多日记" : "加载更多筛选结果"}
            </button>
            <div id="load-more-description" className="sr-only">
              点击加载更早的日记条目，或继续向下滚动自动加载
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiaryTimeline;
