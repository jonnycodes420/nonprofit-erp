// client/src/components/fundraising/RowsPanel.jsx · FLOWS-2 item 1.
// The rows behind a Fundraising tile: the same panel a <Figure> opens
// (MetricBreakdownPanel over a figure source), for a tile that is itself the
// button. Fundraising's Raised tile opened Reports' Giving summary, a page about
// the year, not the gifts behind the number it showed; it opens these now.
// Clicks inside the panel stop here, so they never reach the tile's own click.
import { lazy, Suspense } from "react";
import { retryImport } from "../../lib/lazyRetry";

const MetricBreakdownPanel = lazy(() => retryImport(() => import("../MetricBreakdownPanel")));

export function RowsPanel({ source, title, definition, value, kind = "money", onClose, onOpenPerson }) {
  const stop = e => e.stopPropagation();
  return (
    <span onClick={stop} onKeyDown={stop} data-testid="fr-rows-panel">
      <Suspense fallback={null}>
        <MetricBreakdownPanel open onClose={onClose} title={title} explanation={definition} source={source}
          figure={{ value, kind }} onSelectDonor={onOpenPerson ? row => { onClose(); onOpenPerson(row.donorId); } : undefined} />
      </Suspense>
    </span>
  );
}

export default RowsPanel;
