// FIX-13 Part 6 — a record or page, as a real link. It renders the router's
// <Link> (an <a href>), so Cmd/Ctrl-click, middle-click, Shift-click and
// "Open in new tab" are the browser's, and a plain left click runs `onOpen`
// in this tab exactly as the old click handler did. Without `onOpen` a plain
// click is a router navigation, which App reads back from the URL.
//
// It stops the click from reaching an enclosing clickable row, so a row whose
// name is the link never opens twice (or opens in place on a Cmd-click).
import { Link } from "react-router-dom";
import { isPlainLeftClick, donorHref } from "../lib/appUrls";

// A link looks like the thing it replaced: no underline, and the colour of
// its surroundings unless a className (the nav's CSS) decides the colour.
const BARE = { color: "inherit", textDecoration: "none" };
const BARE_CLASSED = { textDecoration: "none" };

export function RecordLink({ to, onOpen, style, children, ...rest }) {
  const base = rest.className ? BARE_CLASSED : BARE;
  return (
    <Link to={to} {...rest} style={style ? { ...base, ...style } : base}
      onClick={e => {
        e.stopPropagation();
        if (!isPlainLeftClick(e) || !onOpen) return;
        e.preventDefault();
        onOpen(e);
      }}>
      {children}
    </Link>
  );
}

// The donor's name, linking to their profile. `data-donor-link` is what the
// clickability guard looks for.
export function DonorLink({ id, onOpen, children, ...rest }) {
  return <RecordLink to={donorHref(id)} onOpen={onOpen} data-donor-link={id} {...rest}>{children}</RecordLink>;
}
