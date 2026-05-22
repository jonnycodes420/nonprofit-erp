import { Link } from 'react-router-dom';

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap');

*{margin:0;padding:0;box-sizing:border-box}
:root{
  --ink:#0f1117;
  --ink2:#3a3d4a;
  --ink3:#6b7080;
  --paper:#fafaf8;
  --paper2:#f2f1ed;
  --paper3:#e8e6df;
  --green:#1a6b4a;
  --green-light:#e8f5ee;
  --green-mid:#2d9464;
  --accent:#c8f53a;
  --radius:12px;
}
body{font-family:'DM Sans',sans-serif;background:var(--paper);color:var(--ink);line-height:1.6;overflow-x:hidden}

nav{display:flex;align-items:center;justify-content:space-between;padding:20px 48px;border-bottom:1px solid var(--paper3);background:var(--paper);position:sticky;top:0;z-index:100}
.nav-logo{font-family:'DM Serif Display',serif;font-size:22px;color:var(--green);letter-spacing:-0.5px}
.nav-links{display:flex;align-items:center;gap:32px}
.nav-links a{font-size:14px;color:var(--ink2);text-decoration:none;font-weight:400;transition:color .2s}
.nav-links a:hover{color:var(--ink)}
.nav-cta{background:var(--green);color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif;transition:background .2s;text-decoration:none;display:inline-block}
.nav-cta:hover{background:var(--green-mid)}

.hero{padding:100px 48px 80px;max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.hero-eyebrow{display:inline-flex;align-items:center;gap:8px;background:var(--green-light);color:var(--green);font-size:12px;font-weight:500;padding:5px 12px;border-radius:20px;margin-bottom:24px;letter-spacing:.3px}
.hero-eyebrow span{width:6px;height:6px;background:var(--green-mid);border-radius:50%;display:inline-block}
h1{font-family:'DM Serif Display',serif;font-size:52px;line-height:1.08;letter-spacing:-1.5px;color:var(--ink);margin-bottom:20px}
h1 em{font-style:italic;color:var(--green)}
.hero-sub{font-size:17px;color:var(--ink2);line-height:1.65;margin-bottom:36px;font-weight:300;max-width:420px}
.hero-actions{display:flex;align-items:center;gap:16px}
.btn-primary{background:var(--green);color:#fff;padding:13px 28px;border-radius:var(--radius);font-size:15px;font-weight:500;text-decoration:none;font-family:'DM Sans',sans-serif;transition:background .2s;border:none;cursor:pointer;display:inline-block}
.btn-primary:hover{background:var(--green-mid)}
.btn-ghost{color:var(--ink2);font-size:14px;text-decoration:none;display:flex;align-items:center;gap:6px}
.btn-ghost:hover{color:var(--ink)}
.hero-trust{display:flex;align-items:center;gap:20px;margin-top:36px;padding-top:28px;border-top:1px solid var(--paper3)}
.trust-item{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink3)}
.trust-item i{font-size:15px;color:var(--green-mid)}

.hero-visual{background:var(--paper2);border-radius:20px;border:1px solid var(--paper3);overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.07)}
.app-bar{background:#fff;border-bottom:1px solid var(--paper3);padding:12px 20px;display:flex;align-items:center;gap:12px}
.app-dot{width:10px;height:10px;border-radius:50%;background:var(--paper3)}
.app-dot:first-child{background:#ff6b6b}
.app-dot:nth-child(2){background:#ffd93d}
.app-dot:nth-child(3){background:#6bcb77}
.app-bar-title{font-size:12px;color:var(--ink3);margin-left:auto;margin-right:auto}
.app-content{padding:20px}
.app-stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.app-stat{background:#fff;border-radius:10px;padding:14px;border:1px solid var(--paper3)}
.app-stat-label{font-size:10px;color:var(--ink3);margin-bottom:4px}
.app-stat-value{font-size:20px;font-weight:500;color:var(--ink)}
.app-stat-sub{font-size:10px;color:var(--green-mid);margin-top:2px}
.app-kanban{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.kanban-col{background:#fff;border-radius:10px;padding:10px;border:1px solid var(--paper3)}
.kanban-col-title{font-size:9px;font-weight:500;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.kanban-card{background:var(--paper2);border-radius:7px;padding:8px 10px;margin-bottom:6px;border:1px solid var(--paper3)}
.kanban-card-name{font-size:11px;font-weight:500;color:var(--ink);margin-bottom:2px}
.kanban-card-sub{font-size:10px;color:var(--ink3)}
.ai-chip{display:inline-flex;align-items:center;gap:4px;background:var(--green-light);color:var(--green);font-size:9px;padding:2px 7px;border-radius:10px;margin-top:4px}

.logos-bar{border-top:1px solid var(--paper3);border-bottom:1px solid var(--paper3);padding:24px 48px;text-align:center}
.logos-bar p{font-size:12px;color:var(--ink3);margin-bottom:16px;letter-spacing:.3px;text-transform:uppercase}
.logos-row{display:flex;justify-content:center;align-items:center;gap:40px;flex-wrap:wrap}
.logo-pill{background:var(--paper2);border:1px solid var(--paper3);border-radius:8px;padding:8px 20px;font-size:13px;color:var(--ink3);font-weight:500}

.section{padding:80px 48px;max-width:1100px;margin:0 auto}
.section-eyebrow{font-size:12px;font-weight:500;color:var(--green);letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px}
h2{font-family:'DM Serif Display',serif;font-size:38px;letter-spacing:-1px;line-height:1.15;margin-bottom:16px}
.section-sub{font-size:16px;color:var(--ink2);max-width:500px;line-height:1.65;font-weight:300}

.features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:48px}
.feature-card{background:#fff;border:1px solid var(--paper3);border-radius:var(--radius);padding:28px;transition:border-color .2s,box-shadow .2s}
.feature-card:hover{border-color:var(--green-mid);box-shadow:0 8px 32px rgba(26,107,74,.08)}
.feature-icon{width:40px;height:40px;background:var(--green-light);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px}
.feature-icon i{font-size:20px;color:var(--green)}
.feature-title{font-size:15px;font-weight:500;margin-bottom:6px;color:var(--ink)}
.feature-desc{font-size:13px;color:var(--ink3);line-height:1.6}
.feature-badge{display:inline-flex;align-items:center;gap:4px;background:var(--green-light);color:var(--green);font-size:11px;padding:3px 9px;border-radius:10px;margin-top:10px}

.pricing{background:var(--paper2);border-top:1px solid var(--paper3);border-bottom:1px solid var(--paper3);padding:80px 48px}
.pricing-inner{max-width:900px;margin:0 auto}
.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:48px}
.pricing-card{background:#fff;border:1px solid var(--paper3);border-radius:16px;padding:28px;position:relative}
.pricing-card.featured{border:2px solid var(--green);box-shadow:0 8px 40px rgba(26,107,74,.12)}
.pricing-popular{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;font-size:11px;font-weight:500;padding:4px 14px;border-radius:20px;white-space:nowrap}
.pricing-tier{font-size:12px;font-weight:500;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.pricing-price{font-family:'DM Serif Display',serif;font-size:40px;color:var(--ink);letter-spacing:-1px}
.pricing-price span{font-family:'DM Sans',sans-serif;font-size:14px;font-weight:400;color:var(--ink3)}
.pricing-desc{font-size:13px;color:var(--ink3);margin:8px 0 20px;line-height:1.5}
.pricing-divider{border:none;border-top:1px solid var(--paper3);margin:20px 0}
.pricing-feature{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);padding:5px 0}
.pricing-feature i{font-size:15px;color:var(--green-mid);flex-shrink:0}
.pricing-btn{width:100%;margin-top:24px;padding:11px;border-radius:9px;font-size:14px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;border:1.5px solid var(--green);color:var(--green);background:transparent}
.pricing-btn.featured-btn{background:var(--green);color:#fff}
.pricing-btn:hover{background:var(--green);color:#fff}

.compare{background:#fff;border-top:1px solid var(--paper3);padding:32px 48px;text-align:center}
.compare-inner{max-width:640px;margin:0 auto}
.compare p{font-size:14px;color:var(--ink3);margin-bottom:16px}
.compare-chips{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
.chip{background:var(--paper2);border:1px solid var(--paper3);border-radius:8px;padding:8px 16px;font-size:13px;color:var(--ink2)}
.chip s{color:var(--ink3)}
.chip strong{color:var(--green-mid)}

.cta-section{padding:100px 48px;text-align:center;max-width:700px;margin:0 auto}
.cta-section h2{font-size:44px;letter-spacing:-1.5px;margin-bottom:16px}
.cta-section p{font-size:16px;color:var(--ink2);margin-bottom:36px;font-weight:300}
.cta-actions{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}

footer{border-top:1px solid var(--paper3);padding:24px 48px;display:flex;justify-content:space-between;align-items:center}
footer p{font-size:13px;color:var(--ink3)}
.footer-links{display:flex;gap:24px}
.footer-links a{font-size:13px;color:var(--ink3);text-decoration:none}
.footer-links a:hover{color:var(--ink)}

@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.hero>*{animation:fadeUp .6s ease both}
.hero>*:nth-child(2){animation-delay:.1s}
`;

export default function Landing() {
  return (
    <>
      <style>{css}</style>

      <nav>
        <div className="nav-logo">Steward</div>
        <div className="nav-links">
          <a href="#">Features</a>
          <a href="#">Pricing</a>
          <a href="#">About</a>
        </div>
        <Link to="/login" className="nav-cta">Log in</Link>
      </nav>

      <div className="hero">
        <div>
          <div className="hero-eyebrow"><span></span>Built for nonprofits</div>
          <h1>Run your whole org.<br /><em>Not just your CRM.</em></h1>
          <p className="hero-sub">Steward replaces Bloomerang, QuickBooks, and five spreadsheets — one platform for donors, grants, programs, finance, and your team.</p>
          <div className="hero-actions">
            <a href="#" className="btn-primary">Start free trial</a>
            <a href="#" className="btn-ghost">Watch demo <i className="ti ti-arrow-right"></i></a>
          </div>
          <div className="hero-trust">
            <div className="trust-item"><i className="ti ti-lock"></i> SOC 2 ready</div>
            <div className="trust-item"><i className="ti ti-credit-card"></i> No credit card needed</div>
            <div className="trust-item"><i className="ti ti-clock"></i> Setup in 10 min</div>
          </div>
        </div>

        <div className="hero-visual">
          <div className="app-bar">
            <div className="app-dot"></div><div className="app-dot"></div><div className="app-dot"></div>
            <div className="app-bar-title">Steward — CREO Arts</div>
          </div>
          <div className="app-content">
            <div className="app-stat-row">
              <div className="app-stat">
                <div className="app-stat-label">YTD raised</div>
                <div className="app-stat-value">$84k</div>
                <div className="app-stat-sub">↑ 12% vs goal</div>
              </div>
              <div className="app-stat">
                <div className="app-stat-label">Active donors</div>
                <div className="app-stat-value">247</div>
                <div className="app-stat-sub">↑ 18 this month</div>
              </div>
              <div className="app-stat">
                <div className="app-stat-label">Open grants</div>
                <div className="app-stat-value">6</div>
                <div className="app-stat-sub">2 due soon</div>
              </div>
            </div>
            <div className="app-kanban">
              <div className="kanban-col">
                <div className="kanban-col-title">Prospect</div>
                <div className="kanban-card">
                  <div className="kanban-card-name">Maria Chen</div>
                  <div className="kanban-card-sub">$5k capacity</div>
                  <div className="ai-chip"><i className="ti ti-sparkles" style={{fontSize:'9px'}}></i> Call script ready</div>
                </div>
                <div className="kanban-card">
                  <div className="kanban-card-name">J. Whitfield</div>
                  <div className="kanban-card-sub">Board referral</div>
                </div>
              </div>
              <div className="kanban-col">
                <div className="kanban-col-title">Cultivate</div>
                <div className="kanban-card">
                  <div className="kanban-card-name">T. Okonkwo</div>
                  <div className="kanban-card-sub">$12k capacity</div>
                  <div className="ai-chip"><i className="ti ti-sparkles" style={{fontSize:'9px'}}></i> High churn risk</div>
                </div>
              </div>
              <div className="kanban-col">
                <div className="kanban-col-title">Steward</div>
                <div className="kanban-card">
                  <div className="kanban-card-name">R. Patel</div>
                  <div className="kanban-card-sub">$25k · Major</div>
                  <div className="ai-chip"><i className="ti ti-sparkles" style={{fontSize:'9px'}}></i> Renewal due</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="logos-bar">
        <p>Replaces your current stack</p>
        <div className="logos-row">
          <div className="logo-pill">Bloomerang</div>
          <div className="logo-pill">QuickBooks</div>
          <div className="logo-pill">Mailchimp</div>
          <div className="logo-pill">GrantStation</div>
          <div className="logo-pill">Spreadsheets</div>
        </div>
      </div>

      <div className="section">
        <div className="section-eyebrow">Everything in one place</div>
        <h2>The full stack for<br />mission-driven orgs</h2>
        <p className="section-sub">Every tool your nonprofit needs — built together, not bolted together.</p>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon"><i className="ti ti-users" aria-hidden="true"></i></div>
            <div className="feature-title">Donor moves management</div>
            <div className="feature-desc">Kanban pipeline from Prospect to Steward. Track every touchpoint, interaction, and next move.</div>
            <div className="feature-badge"><i className="ti ti-sparkles" style={{fontSize:'11px'}}></i> AI next-move suggestions</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><i className="ti ti-file-text" aria-hidden="true"></i></div>
            <div className="feature-title">Grants management</div>
            <div className="feature-desc">Track deadlines, draft LOIs, write reports, and discover new funders — all AI-assisted.</div>
            <div className="feature-badge"><i className="ti ti-sparkles" style={{fontSize:'11px'}}></i> AI LOI drafting</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><i className="ti ti-mail" aria-hidden="true"></i></div>
            <div className="feature-title">Communications hub</div>
            <div className="feature-desc">Segmented email campaigns with AI copywriting, open rate tracking, and SMTP delivery.</div>
            <div className="feature-badge"><i className="ti ti-sparkles" style={{fontSize:'11px'}}></i> AI email copy</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><i className="ti ti-chart-bar" aria-hidden="true"></i></div>
            <div className="feature-title">Finance &amp; reporting</div>
            <div className="feature-desc">Budget tracking, grant allocation, YTD vs goal dashboards, and AI-powered forecasting.</div>
            <div className="feature-badge"><i className="ti ti-sparkles" style={{fontSize:'11px'}}></i> AI forecast</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><i className="ti ti-clipboard-list" aria-hidden="true"></i></div>
            <div className="feature-title">Program management</div>
            <div className="feature-desc">Track outcomes, measure impact, and generate funder-ready reports automatically.</div>
            <div className="feature-badge"><i className="ti ti-sparkles" style={{fontSize:'11px'}}></i> AI impact reports</div>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><i className="ti ti-shield-check" aria-hidden="true"></i></div>
            <div className="feature-title">Role-based access</div>
            <div className="feature-desc">Admin and staff roles with fine-grained permissions. Board, volunteer, and team management built in.</div>
          </div>
        </div>
      </div>

      <div className="pricing">
        <div className="pricing-inner">
          <div style={{textAlign:'center'}}>
            <div className="section-eyebrow" style={{textAlign:'center'}}>Simple pricing</div>
            <h2>Transparent, flat-rate plans</h2>
            <p className="section-sub" style={{margin:'0 auto',textAlign:'center'}}>No per-seat fees. No module unlocks. Everything included.</p>
          </div>
          <div className="pricing-grid">
            <div className="pricing-card">
              <div className="pricing-tier">Seed</div>
              <div className="pricing-price">$149<span>/mo</span></div>
              <div className="pricing-desc">Small orgs up to $500k annual budget</div>
              <hr className="pricing-divider" />
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Up to 500 donors</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Donor + grants modules</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> 2 staff seats</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> AI features included</div>
              <button className="pricing-btn" onClick={() => alert('Connect signup flow')}>Get started</button>
            </div>
            <div className="pricing-card featured">
              <div className="pricing-popular">Most popular</div>
              <div className="pricing-tier">Growth</div>
              <div className="pricing-price">$249<span>/mo</span></div>
              <div className="pricing-desc">Growing orgs up to $2M annual budget</div>
              <hr className="pricing-divider" />
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Unlimited donors</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> All modules</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> 10 staff seats</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Priority AI + email</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> CSV import</div>
              <button className="pricing-btn featured-btn" onClick={() => alert('Connect signup flow')}>Get started</button>
            </div>
            <div className="pricing-card">
              <div className="pricing-tier">Impact</div>
              <div className="pricing-price">$399<span>/mo</span></div>
              <div className="pricing-desc">Established orgs, multi-program</div>
              <hr className="pricing-divider" />
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Everything in Growth</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Unlimited seats</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Custom domain email</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> Dedicated onboarding</div>
              <div className="pricing-feature"><i className="ti ti-check" aria-hidden="true"></i> SLA + priority support</div>
              <button className="pricing-btn" onClick={() => alert('Connect signup flow')}>Get started</button>
            </div>
          </div>
        </div>
      </div>

      <div className="compare">
        <div className="compare-inner">
          <p>Replace your entire stack for less than one tool costs today</p>
          <div className="compare-chips">
            <div className="chip"><s>Bloomerang $199/mo</s> + <s>QuickBooks $85/mo</s> + <s>Mailchimp $60/mo</s> = <strong>$344+</strong></div>
          </div>
          <p style={{marginTop:'12px',fontSize:'13px',color:'var(--green-mid)'}}>Steward Growth: $249/mo. Everything included.</p>
        </div>
      </div>

      <div className="cta-section">
        <div className="hero-eyebrow" style={{justifyContent:'center',marginBottom:'20px'}}><span></span>Free 14-day trial</div>
        <h2>Ready to run your org smarter?</h2>
        <p>No credit card. No spreadsheets. No switching headache.</p>
        <div className="cta-actions">
          <a href="#" className="btn-primary">Start your free trial</a>
          <a href="#" className="btn-ghost">Book a demo <i className="ti ti-arrow-right"></i></a>
        </div>
      </div>

      <footer>
        <div className="nav-logo" style={{fontSize:'18px'}}>Steward</div>
        <p>© 2026 Steward. Built for nonprofits.</p>
        <div className="footer-links">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Contact</a>
        </div>
      </footer>
    </>
  );
}
