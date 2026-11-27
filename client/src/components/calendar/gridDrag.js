// POLISH-15 item 3 (W-1127-Volunteers-02) · A CALENDAR DRAG IS A DISTANCE, NOT A HOLD.
//
// "A quick calendar drag gives no feedback; only a held drag moves the
// meeting." The grid listened for the pointer's moves and its release from a
// useEffect, which runs only after React has drawn the drag's first frame. A
// quick drag (press, move, release in one go, as a trackpad flick or an
// automated drag sends it) was over before the listeners existed: the move
// was lost, the release was lost, and the click that followed opened the
// meeting instead. A held drag worked because the listeners had time to land.
//
// Now the listeners are added in the press itself, so nothing between press
// and release can be missed. A drag is 6 px or more of travel (straight-line
// distance), never a time held; less than that is a click and opens the item.
import { useState, useRef, useEffect } from "react";

export const DRAG_PX = 6;

// How far a finished drag moves the item: whole days across, and minutes down
// snapped to `snap`. A drag of DRAG_PX or more that is mostly up or down always
// moves at least one snap step, so a short drag is never silently nothing.
export function dropOf(d, { colW, hourPx, snap }) {
  const days = d.mode === "move" ? Math.round(d.dx / colW) : 0;
  if (d.allDay) return { days, minutes: 0 };
  let minutes = Math.round(((d.dy / hourPx) * 60) / snap) * snap;
  if (!minutes && !days && Math.abs(d.dy) >= DRAG_PX && Math.abs(d.dy) >= Math.abs(d.dx)) minutes = Math.sign(d.dy) * snap;
  return { days, minutes };
}

// The drag's state and its press handler. `onDrop(d)` runs once, on release,
// only when the pointer travelled DRAG_PX or more.
export function useGridDrag(onDrop) {
  const [drag, setDrag] = useState(null);   // { item, mode, allDay, x0, y0, dx, dy, moved }
  const dragRef = useRef(null);
  const justDragged = useRef(false);        // the click that ends a drag is not a click on the item
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const stopRef = useRef(null);
  useEffect(() => () => { if (stopRef.current) stopRef.current(); }, []);

  const begin = (e, payload) => {
    if (stopRef.current) stopRef.current();
    const at = ev => {
      const d = dragRef.current; if (!d) return null;
      const dx = ev.clientX - d.x0, dy = ev.clientY - d.y0;
      const next = { ...d, dx, dy, moved: d.moved || Math.hypot(dx, dy) >= DRAG_PX };
      dragRef.current = next;
      return next;
    };
    const mv = ev => { const next = at(ev); if (next) setDrag(next); };
    const stop = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      stopRef.current = null;
    };
    const up = ev => {
      const d = at(ev);
      stop();
      dragRef.current = null;
      setDrag(null);
      if (d && d.moved) {
        justDragged.current = true;
        setTimeout(() => { justDragged.current = false; }, 50);
        onDropRef.current(d);
      }
    };
    const cancel = () => { stop(); dragRef.current = null; setDrag(null); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    stopRef.current = stop;
    dragRef.current = { ...payload, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false };
    setDrag(dragRef.current);
  };
  return { drag, begin, justDragged };
}
