import { useEffect, useRef } from 'react';

const diameter = 240;
const magnification = 2;

/** 描画済みの図だけを複製し、元のビューポートや操作対象を変更せずに拡大する。 */
export function Magnifier() {
  const lens = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = lens.current!;
    const copy = content.current!;
    const host = element.closest<HTMLElement>('.react-flow')!;
    const viewport = host.querySelector<HTMLElement>('.react-flow__viewport')!;
    let point: { x: number; y: number } | undefined;
    let frame: number | undefined;
    let dirty = true;
    const render = () => {
      frame = undefined;
      if (!point) return;
      const bounds = host.getBoundingClientRect();
      const size = Math.min(diameter, bounds.width, bounds.height);
      const radius = size / 2;
      const left = Math.max(0, Math.min(bounds.width - size, point.x - radius));
      const top = Math.max(0, Math.min(bounds.height - size, point.y - radius));
      copy.style.width = `${bounds.width}px`;
      copy.style.height = `${bounds.height}px`;
      element.style.width = element.style.height = `${size}px`;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.hidden = false;
      // 端でルーペを内側へ寄せても、枠線を除いたポインターの位置を拡大の基準にする。
      copy.style.transform = `translate(${point.x - left - element.clientLeft - point.x * magnification}px, ${point.y - top - element.clientTop - point.y * magnification}px) scale(${magnification})`;
      if (dirty) {
        const clone = viewport.cloneNode(true) as HTMLElement;
        // SVGのマーカー参照を複製内で完結させ、元の図のIDと衝突させない。
        const ids = new Map<string, string>();
        for (const node of clone.querySelectorAll('[id]')) {
          ids.set(node.id, `magnifier-${node.id}`);
          node.id = ids.get(node.id)!;
        }
        for (const node of clone.querySelectorAll('*')) {
          for (const attribute of [...node.attributes]) {
            const value = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id: string) =>
              ids.has(id) ? `url(#${ids.get(id)})` : match,
            );
            node.setAttribute(attribute.name, value);
          }
        }
        copy.replaceChildren(clone);
        dirty = false;
      }
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(render);
    };
    const move = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.react-flow__panel')) {
        element.hidden = true;
        point = undefined;
        return;
      }
      const bounds = host.getBoundingClientRect();
      point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      schedule();
    };
    const leave = () => {
      point = undefined;
      element.hidden = true;
    };
    const observer = new MutationObserver(() => {
      dirty = true;
      schedule();
    });
    observer.observe(viewport, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      observer.disconnect();
      resize.disconnect();
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="magnifier" ref={lens} hidden aria-hidden="true" inert>
      <div className="magnifier-content" ref={content} />
      <span className="magnifier-badge">2×</span>
    </div>
  );
}
