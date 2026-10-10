import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type ElementRef = RefObject<HTMLElement | null>;

export function useFloatingPopover({
  open,
  anchor,
  panel,
  width,
  align = "start",
}: {
  open: boolean;
  anchor: ElementRef;
  panel: ElementRef;
  width: number;
  align?: "start" | "center";
}) {
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const content = anchor.current.closest<HTMLElement>(".emoji-reactions");
    const update = () => {
      if (!anchor.current || !panel.current) return;
      const bounds = anchor.current.getBoundingClientRect();
      const area = content?.getBoundingClientRect();
      const leftEdge = Math.max(16, area?.left ?? 16);
      const rightEdge = Math.min(
        window.innerWidth - 16,
        area?.right ?? window.innerWidth - 16
      );
      const panelWidth = Math.min(width, Math.max(1, rightEdge - leftEdge));
      const preferredLeft =
        align === "center"
          ? bounds.left + (bounds.width - panelWidth) / 2
          : bounds.left;
      const height = panel.current.offsetHeight;
      const above = bounds.top - height - 8;
      const next = {
        left: Math.max(
          leftEdge,
          Math.min(preferredLeft, rightEdge - panelWidth)
        ),
        top:
          above >= 16
            ? above
            : Math.max(
                16,
                Math.min(bounds.bottom + 8, window.innerHeight - height - 16)
              ),
        width: panelWidth,
      };
      setPosition(previous =>
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width
          ? previous
          : next
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel.current);
    observer.observe(anchor.current);
    if (content) observer.observe(content);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor, panel, width, align]);
  return position;
}

export function usePopoverDismiss({
  open,
  anchor,
  panel,
  busy = false,
  onDismiss,
}: {
  open: boolean;
  anchor: ElementRef;
  panel: ElementRef;
  busy?: boolean;
  onDismiss: () => void;
}) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open || busy) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target))
        dismiss.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss.current();
        anchor.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, busy, anchor, panel]);
}
