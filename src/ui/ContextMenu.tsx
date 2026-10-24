import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** custom content (colour palette, width picker …) rendered instead of a button */
  render?: () => ReactNode;
  testid?: string;
}

export type MenuEntry = MenuItem | 'sep' | { title: string };

/** Right-click menu positioned at the pointer and kept inside the viewport. */
export function ContextMenu({ x, y, items, onClose, testid }: { x: number; y: number; items: MenuEntry[]; onClose(): void; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" data-testid={testid ?? 'context-menu'} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="ctx-sep" />;
        if ('title' in it) return <div key={i} className="ctx-title">{it.title}</div>;
        if (it.render) return <div key={i} className="ctx-custom">{it.render()}</div>;
        return (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            data-testid={it.testid}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
