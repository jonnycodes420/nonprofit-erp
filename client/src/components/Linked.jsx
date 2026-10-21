// THREAD-2 · EVERY NAME IS A LINK. The one renderer for a sentence that
// names things: each named person, gift, task, meeting, journey, event,
// campaign or group is a real link (shared/itemLinks.js says where), and the
// rest is text. A Thread row, a Tell Steward result and an Agent card all
// render through this, so a new kind of item gets its links for free.
//
// Links are RecordLinks: a plain click is the app's own navigation, and
// Cmd-click or middle-click opens a new tab. Each stops the click from
// reaching the row it sits in.
import { Fragment } from "react";
import { RecordLink } from "./RecordLink";
import { linkSegments, refPath, refLabel } from "../../../shared/itemLinks.js";
import { T } from "./shared";

const LINK = { color: "inherit", textDecoration: "underline", textDecorationColor: "#0d5c3a", textUnderlineOffset: 2 };

// One named thing. Without a page it is its words.
export function RefLink({ refItem, children, style, onOpen, ...rest }) {
  const to = refPath(refItem);
  const words = children != null ? children : refLabel(refItem);
  if (!to) return <span {...rest}>{words}</span>;
  return (
    <RecordLink to={to} data-ref-kind={refItem.kind} data-ref-id={refItem.id || undefined}
      onOpen={onOpen ? e => onOpen(refItem, to, e) : undefined}
      style={{ ...LINK, ...(style || {}) }} {...rest}>{words}</RecordLink>
  );
}

// A sentence with every named thing linked.
export function Linked({ text, refs, linkStyle, onOpen }) {
  const segs = linkSegments(text, refs);
  return <>{segs.map((s, i) => s.ref
    ? <RefLink key={i} refItem={s.ref} style={linkStyle} onOpen={onOpen}>{s.text}</RefLink>
    : <Fragment key={i}>{s.text}</Fragment>)}</>;
}

export const LINK_EMERALD = { color: T.greenDk };
