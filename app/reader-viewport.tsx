"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

export const READER_PAGE_WIDTH = 576;
const SPREAD_WIDTH = 1200;
export const MIN_READER_ZOOM = 0.5;
export const MAX_READER_ZOOM = 3;
const MIN_SOURCE_PERCENT = 25;
const MAX_SOURCE_PERCENT = 75;

const ReaderColumns = createContext<{
  sourcePercent: number;
  resize: (percent: number) => void;
  setResizing: (active: boolean) => void;
  label: string;
  valueText: (percent: number) => string;
} | null>(null);

export function ReaderDivider() {
  const columns = useContext(ReaderColumns);
  const drag = useRef<{ pointerId: number; offset: number; initial: number } | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const stopResizing = columns?.setResizing;
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (drag.current) stopResizing?.(false);
  }, [stopResizing]);
  if (!columns) return null;
  const { sourcePercent, resize, setResizing, label, valueText } = columns;
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current !== null) resize(pending.current);
    pending.current = null;
  };
  const finish = (node: HTMLDivElement) => {
    const active = drag.current;
    if (!active) return;
    flush();
    drag.current = null;
    setResizing(false);
    if (node.hasPointerCapture(active.pointerId)) node.releasePointerCapture(active.pointerId);
  };
  return (
    <div
      className="reader-divider"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={MIN_SOURCE_PERCENT}
      aria-valuemax={MAX_SOURCE_PERCENT}
      aria-valuenow={Math.round(sourcePercent)}
      aria-valuetext={valueText(Math.round(sourcePercent))}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, offset: event.clientX - bounds.left - bounds.width * sourcePercent / 100, initial: sourcePercent };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        pending.current = (event.clientX - bounds.left - drag.current.offset) / bounds.width * 100;
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      }}
      onPointerUp={(event) => finish(event.currentTarget)}
      onPointerCancel={(event) => finish(event.currentTarget)}
      onLostPointerCapture={(event) => finish(event.currentTarget)}
      onDoubleClick={() => resize(50)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          pending.current = drag.current.initial;
          finish(event.currentTarget);
          return;
        }
        if (drag.current) return;
        const step = event.shiftKey ? 5 : 1;
        const next = { ArrowLeft: sourcePercent - step, ArrowRight: sourcePercent + step,
          Home: MIN_SOURCE_PERCENT, End: MAX_SOURCE_PERCENT, Enter: 50 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        resize(next);
      }}
    ><span aria-hidden="true" /></div>
  );
}

export function ReaderViewport({ children, zoom, onZoom, currentPage, dividerLabel, dividerValueText }: {
  children: ReactNode;
  zoom: number;
  onZoom: (update: (zoom: number) => number) => void;
  currentPage: number;
  dividerLabel: string;
  dividerValueText: (percent: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [sourcePercent, setSourcePercent] = useState(50);
  const [resizing, setResizing] = useState(false);
  const previousFitScale = useRef(1);
  const anchor = useRef<{ page: number; top: number; fraction: number } | null>(null);
  const rememberAnchor = useCallback(() => {
    const node = ref.current?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const top = Math.max(130, rect.top);
    anchor.current = { page: currentPage, top, fraction: (top - rect.top) / rect.height };
  }, [currentPage]);

  const resize = useCallback((percent: number) => {
    const next = Math.min(MAX_SOURCE_PERCENT, Math.max(MIN_SOURCE_PERCENT, percent));
    if (!Number.isFinite(next) || next === sourcePercent) return;
    rememberAnchor();
    setSourcePercent(next);
  }, [rememberAnchor, sourcePercent]);
  const columns = useMemo(() => ({ sourcePercent, resize, setResizing, label: dividerLabel, valueText: dividerValueText }),
    [sourcePercent, resize, dividerLabel, dividerValueText]);

  useEffect(() => {
    if (!resizing) return;
    document.documentElement.classList.add("reader-resizing");
    return () => document.documentElement.classList.remove("reader-resizing");
  }, [resizing]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const next = Math.max(0.1, (node.clientWidth - 16) / SPREAD_WIDTH);
      if (Math.abs(next - previousFitScale.current) < 0.0001) return;
      rememberAnchor();
      previousFitScale.current = next;
      setFitScale(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [rememberAnchor]);

  useLayoutEffect(() => {
    if (zoom === 1 && ref.current) ref.current.scrollLeft = 0;
    const saved = anchor.current;
    anchor.current = null;
    if (!saved) return;
    const node = ref.current?.querySelector<HTMLElement>(`[data-page="${saved.page}"]`);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    window.scrollBy({ top: rect.top + saved.fraction * rect.height - saved.top, behavior: "instant" });
  }, [fitScale, zoom, sourcePercent]);

  useEffect(() => {
    const change = (update: (value: number) => number) => {
      rememberAnchor();
      onZoom((value) => Math.min(MAX_READER_ZOOM, Math.max(MIN_READER_ZOOM, update(value))));
    };
    const controlZoom = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".reader-zoom")) rememberAnchor();
    };
    const keydown = (event: KeyboardEvent) => {
      if (["Enter", " "].includes(event.key)) controlZoom(event);
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!["+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      change((value) => event.key === "0" ? 1 : value + (event.key === "-" ? -0.1 : 0.1));
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      change((value) => value * Math.exp(-event.deltaY * 0.002));
    };
    window.addEventListener("pointerdown", controlZoom, { capture: true });
    window.addEventListener("keydown", keydown, { capture: true });
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("pointerdown", controlZoom, { capture: true });
      window.removeEventListener("keydown", keydown, { capture: true });
      window.removeEventListener("wheel", wheel, { capture: true });
    };
  }, [onZoom, rememberAnchor]);

  return (
    <ReaderColumns.Provider value={columns}>
      <div className="reader-viewport" ref={ref} data-resizing={resizing || undefined}>
        <div className="spreads" style={{ width: SPREAD_WIDTH, zoom: fitScale * zoom,
          "--reader-source-width": `${sourcePercent}%`, "--reader-scale": fitScale * zoom } as CSSProperties}>{children}</div>
      </div>
    </ReaderColumns.Provider>
  );
}
