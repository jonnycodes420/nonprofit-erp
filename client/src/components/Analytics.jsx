import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmt, fmtFull, SC, STAGES, Pill, Card, SectionLabel, PageTitle } from "./shared";

function BarChart({ data, color = "#10b981", height = 80 }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: height + 18 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: Math.max(3, (d.v / max) * height), background: d.color || color, borderRadius: "3px 3px 0 0", opacity: 0.9, transition: "height 0.3s" }} />
          <div style={{ fontSize: 9, color: T.ink3, whiteSpace: "nowrap", overflow: "hidden", maxWidth: "100%", textAlign: "center" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function HBarChart({ data }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 68, fontSize: 11, color: T.ink3, textAlign: "right", flexShrink: 0, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
          <div style={{ flex: 1, height: 18, background: T.bg2, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${d.v > 0 ? Math.max((d.v / max) * 100, 4) : 0}%`, background: d.color || "#1a6b4a", borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ width: 22, fontSize: 11, fontWeight: 700, color: T.ink, textAlign: "right", flexShrink: 0 }}>{d.v}</div>
        </div>
      ))}
    </div>
  );
}

export function Analytics({ data }) {
  const [campaigns, setCampaigns] = useState([]);

  useEffect(() => {
    apiFetch("/email/campaigns").then(rows => setCampaigns(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);

  const currentYear = new Date().getFullYear();

  // Chart 1: Giving Trend
  const givingTrend = data.financials.revenue.map(m => ({
    label: m.month.slice(0, 3),
    v: m.individual + m.grants + m.events + m.other,
  }));

  // Chart 2: Donor Retention
  const newDonors = data.donors.filter(d => d.status === "new" && d.lastGift?.startsWith(String(currentYear)));
  const retainedDonors = data.donors.filter(d => ["major", "mid", "converted"].includes(d.status) && d.lastGift?.startsWith(String(currentYear)));
  const lapsedDonors = data.donors.filter(d => d.status === "lapsed");
  const retentionData = [
    { label: "New", v: newDonors.length, color: "#8b5cf6" },
    { label: "Retained", v: retainedDonors.length, color: "#1a6b4a" },
    { label: "Lapsed", v: lapsedDonors.length, color: "#f59e0b" },
  ];

  // Chart 3: Pipeline Velocity
  const stageData = STAGES.map(s => ({
    label: s.label,
    v: data.donors.filter(d => d.stage === s.id).length,
    color: s.color === T.ink3 ? "#9ca3af" : s.color,
  }));

  // Chart 4: Grant Pipeline by status
  const allStatuses = [...new Set(data.grants.map(g => g.status))];
  const statusOrder = ["prospecting", "loi", "applied", "active", "pending", "awarded", "closed", "rejected"];
  const sortedStatuses = [
    ...statusOrder.filter(s => allStatuses.includes(s)),
    ...allStatuses.filter(s => !statusOrder.includes(s)),
  ];
  const grantStatusData = sortedStatuses.map(s => ({
    label: s,
    v: data.grants.filter(g => g.status === s).reduce((sum, g) => sum + g.amount, 0),
    color: SC[s] || "#6b7280",
  }));

  // Chart 5: Email Performance
  const recentCampaigns = [...campaigns]
    .filter(c => c.status === "sent")
    .sort((a, b) => new Date(b.sent_at || 0) - new Date(a.sent_at || 0))
    .slice(0, 10);

  // Chart 6: Top Donors
  const topDonors = [...data.donors].sort((a, b) => b.total - a.total).slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageTitle main="Your" accent="analytics." />

      <div className="analytics-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>

        <Card>
          <SectionLabel>Giving Trend</SectionLabel>
          <div style={{ fontSize: 11, color: T.ink3, marginBottom: 12 }}>Monthly revenue, all sources</div>
          {givingTrend.every(d => d.v === 0)
            ? <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "28px 0" }}>No financial data yet</div>
            : <BarChart data={givingTrend} color="#10b981" />}
        </Card>

        <Card>
          <SectionLabel>Donor Retention</SectionLabel>
          <div style={{ fontSize: 11, color: T.ink3, marginBottom: 12 }}>New · Retained · Lapsed this year</div>
          <BarChart data={retentionData} height={80} />
          <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
            {retentionData.map(d => (
              <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: T.ink3 }}>{d.label}: <span style={{ fontWeight: 700, color: T.ink }}>{d.v}</span></div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionLabel>Pipeline Velocity</SectionLabel>
          <div style={{ fontSize: 11, color: T.ink3, marginBottom: 12 }}>Donors by cultivation stage</div>
          {stageData.every(d => d.v === 0)
            ? <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "28px 0" }}>No donors in pipeline yet</div>
            : <HBarChart data={stageData} />}
        </Card>

        <Card>
          <SectionLabel>Grant Pipeline</SectionLabel>
          <div style={{ fontSize: 11, color: T.ink3, marginBottom: 12 }}>Total ask by status</div>
          {grantStatusData.length === 0 || grantStatusData.every(d => d.v === 0)
            ? <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "28px 0" }}>No grants in pipeline yet</div>
            : <>
              <BarChart data={grantStatusData} color="#3b82f6" />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                {grantStatusData.map(d => (
                  <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                    <div style={{ fontSize: 10, color: T.ink3 }}>{d.label}: <span style={{ fontWeight: 700, color: T.ink }}>{fmt(d.v)}</span></div>
                  </div>
                ))}
              </div>
            </>}
        </Card>

        <Card>
          <SectionLabel>Email Performance</SectionLabel>
          <div style={{ fontSize: 11, color: T.ink3, marginBottom: 12 }}>Open rate, last {recentCampaigns.length || 0} campaigns</div>
          {recentCampaigns.length === 0
            ? <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "28px 0" }}>No campaigns sent yet</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {recentCampaigns.map(c => {
                const sent = c.recipient_count || 0;
                const opens = c.open_count || 0;
                const rate = sent > 0 ? Math.round((opens / sent) * 100) : 0;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || c.subject || "Campaign"}</div>
                    <div style={{ width: 80, height: 10, background: T.bg2, borderRadius: 3, flexShrink: 0, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(rate, 100)}%`, background: "#10b981", borderRadius: 3 }} />
                    </div>
                    <div style={{ width: 30, fontSize: 11, color: T.ink3, textAlign: "right", flexShrink: 0 }}>{rate}%</div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981" }} />
                  <div style={{ fontSize: 10, color: T.ink3 }}>Open rate</div>
                </div>
              </div>
            </div>}
        </Card>

        <div style={{ gridColumn: "1 / -1" }}>
          <Card>
            <SectionLabel>Top Donors</SectionLabel>
            <div style={{ fontSize: 11, color: T.ink3, marginBottom: 12 }}>By lifetime giving</div>
            {topDonors.length === 0
              ? <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "24px 0" }}>No donors yet</div>
              : <div style={{ display: "flex", flexDirection: "column" }}>
                {topDonors.map((d, i) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < topDonors.length - 1 ? "1px solid " + T.bg2 : "none" }}>
                    <div style={{ width: 22, fontSize: 12, color: T.ink3, fontWeight: 700, textAlign: "center", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>Last gift: {d.lastGift || "—"}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#1a6b4a" }}>{fmtFull(d.total)}</div>
                      {d.wealthScore != null && <div style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>Score {d.wealthScore}</div>}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <Pill label={d.stage} color={SC[d.stage] || "#6b7280"} />
                    </div>
                  </div>
                ))}
              </div>}
          </Card>
        </div>

      </div>
    </div>
  );
}
