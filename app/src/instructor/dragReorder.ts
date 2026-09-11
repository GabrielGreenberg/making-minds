import { useEffect, useRef, useState } from 'react';

/**
 * Drag-to-reorder for the instructor's lists (the assignment table and an
 * assignment's question list).
 *
 * `moveItem` is the pure rearrangement — splice out, splice back in — and the
 * hook drives it live: every dragenter over a new row re-runs it on the
 * PREVIEW copy, so the list rearranges under the cursor and the drop merely
 * commits what is already on screen. Rows can be pinned (bundled assignments
 * live outside the store and cannot be renumbered): a pinned row can neither
 * be picked up nor be displaced by a row dragged past it.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export interface RowDragProps {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export interface DragReorder<T> {
  /** What to render: the live preview while dragging, the source list otherwise. */
  items: T[];
  /** Index of the row being dragged (in `items`), or null. */
  draggingIndex: number | null;
  /** Handlers for the row at `index`; spread onto the row element. */
  rowProps: (index: number) => RowDragProps;
}

export function useDragReorder<T>(
  source: T[],
  commit: (next: T[]) => void,
  isPinned: (item: T) => boolean = () => false,
): DragReorder<T> {
  const [preview, setPreview] = useState<T[] | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // dragend fires after drop; this tells a committed drag from a cancelled one.
  const dropped = useRef(false);
  const items = preview ?? source;

  // A committed reorder keeps its preview until the new source arrives (the
  // store round-trip is async on the dashboard); a cancelled drag has already
  // cleared it in onDragEnd.
  useEffect(() => {
    if (draggingIndex === null) setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const rowProps = (index: number): RowDragProps => ({
    draggable: !isPinned(items[index]),
    onDragStart: (e) => {
      if (isPinned(items[index])) return;
      e.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without payload.
      e.dataTransfer.setData('text/plain', String(index));
      dropped.current = false;
      setPreview(items);
      setDraggingIndex(index);
    },
    onDragEnter: (e) => {
      if (draggingIndex === null || index === draggingIndex) return;
      if (isPinned(items[index])) return;
      e.preventDefault();
      setPreview(moveItem(items, draggingIndex, index));
      setDraggingIndex(index);
    },
    onDragOver: (e) => {
      if (draggingIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e) => {
      if (draggingIndex === null) return;
      e.preventDefault();
      dropped.current = true;
      setDraggingIndex(null);
      if (preview) commit(preview);
    },
    onDragEnd: () => {
      // Reached after a drop too; only a cancelled drag still holds a preview
      // that nothing committed.
      if (!dropped.current) setPreview(null);
      dropped.current = false;
      setDraggingIndex(null);
    },
  });

  return { items, draggingIndex, rowProps };
}
