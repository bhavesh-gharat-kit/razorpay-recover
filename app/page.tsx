import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans, Schibsted_Grotesk } from "next/font/google";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/Reveal";
import { CountUp } from "@/components/landing/CountUp";
import { TiltCard } from "@/components/landing/TiltCard";
import { ParticleField } from "@/components/landing/ParticleField";
import { LandingNav } from "@/components/landing/LandingNav";
import "./landing.css";

const display = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--lp-font-display",
  display: "swap",
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--lp-font-body",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--lp-font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recover — revenue recovery for Razorpay merchants",
  description:
    "Recover turns a failed payment into a diagnosed, bounded, fully-logged attempt to collect the money. Built for the Razorpay AI Buildathon, Track 03.",
};

const STAGES = [
  { icon: "detect", name: "Detect", copy: "A payment.failed webhook, an abandoned checkout, or an overdue invoice opens a case." },
  { icon: "diagnose", name: "Diagnose", copy: "A rules table maps the Razorpay code to a cause. Unclear ones go to review, never a guess." },
  { icon: "decide", name: "Decide", copy: "The policy for that cause picks one action and mints a real Razorpay Payment Link." },
  { icon: "draft", name: "Draft", copy: "A template fills in the real name, amount and link — no invented facts." },
  { icon: "send", name: "Send", copy: "The message goes out over email via Brevo, with the delivery reference recorded." },
  { icon: "recover", name: "Recover", copy: "When the customer pays, the amount and time-to-recovery are logged on the case." },
] as const;

const SCENARIOS = [
  {
    icon: "cart",
    kicker: "Checkout drop-off",
    title: "The customer left at payment",
    copy: "A card declined, funds were short, an OTP was abandoned, the gateway timed out. Recover sends a reassuring retry link inside the allowed hours.",
    codes: ["CARD_EXPIRED", "INSUFFICIENT_FUNDS", "OTP_ABANDONED", "GATEWAY_TIMEOUT"],
  },
  {
    icon: "repeat",
    kicker: "Failed subscriptions",
    title: "A renewal didn't go through",
    copy: "The auto-pay mandate lapsed, expired, or hit a low balance. Recover explains that the authorization itself needs re-doing and links straight to it.",
    codes: ["MANDATE_LAPSED", "MANDATE_EXPIRED_CARD", "MANDATE_INSUFFICIENT_FUNDS"],
  },
  {
    icon: "invoice",
    kicker: "Overdue invoices",
    title: "A B2B invoice is past due",
    copy: "A three-tier ladder — a friendly nudge, then a firm reminder, then escalate to a human. Large balances always reach a person first.",
    codes: ["INVOICE_OVERDUE", "Tier 1 → 2 → 3"],
  },
] as const;

const GUARDS = [
  { icon: "gauge", title: "Low confidence goes to a human", copy: "If the diagnosis scores below the policy threshold, the case is held for review — never sent on a guess." },
  { icon: "shield", title: "Large amounts go to a human", copy: "Anything over the review threshold waits for an approval before any outreach leaves the system." },
  { icon: "clock", title: "One conversation at a time", copy: "A per-cause cooldown stops Recover contacting the same customer twice in quick succession." },
  { icon: "moon", title: "Civil hours only", copy: "Outreach is pinned to an IST send window per cause code. Nothing goes out at 3am." },
  { icon: "hand", title: "A hard attempt cap", copy: "Once the maximum attempts for a cause are spent, the agent stops and the case is closed or escalated." },
  { icon: "ledger", title: "No silent actions", copy: "Every transition — the agent's own included — writes a reason and an actor before it takes effect." },
] as const;

const CHECKS = [
  {
    icon: "eye",
    q: "Is it explainable?",
    a: "Open any case and read the audit timeline: cause, confidence, the scheduled action, the draft, the delivery reference.",
    path: "Cases → open a row → Audit timeline",
  },
  {
    icon: "sliders",
    q: "Is it bounded?",
    a: "Change a cooldown on the Policies screen, reload, see it stick. Then open Approvals to see what the agent declined to act on, and why.",
    path: "Policies → edit → reload · then Approvals",
  },
  {
    icon: "download",
    q: "Is the audit trail real?",
    a: "On a case page, click Download Audit Trail (CSV) and check a row against the on-screen timeline and the delivery provider reference.",
    path: "Cases → open a row → Download Audit Trail (CSV)",
  },
  {
    icon: "trending",
    q: "Is recovery actually measured?",
    a: "Note “Total recovered” on the summary, mark a sent case recovered, come back — the figure moves by exactly that amount and average time updates.",
    path: "Summary → a sent case → Mark Recovered → Summary",
  },
] as const;

export default function LandingPage() {
  return (
    <div className={`lp ${display.variable} ${body.variable} ${mono.variable}`}>
      <ParticleField />
      <div className="lp-aura" aria-hidden="true" />
      <div className="lp-grain" aria-hidden="true" />

      <LandingNav />

      {/* ---------------- hero ---------------- */}
      <header className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <p className="tagline">Razorpay AI Buildathon · Track 03</p>
        <h1>
          <span className="ln"><span>A failed payment</span></span>
          <span className="ln"><span>is money you</span></span>
          <span className="ln"><span><span className="accent">already earned</span>.</span></span>
        </h1>
        <p className="sub">
          Recover watches your Razorpay payment stream for the ones that didn&apos;t go
          through — a card that expired, a balance that was short, a mandate that lapsed,
          an invoice past due — works out why, and runs one careful, policy-bounded attempt
          to get it back. Every step is written down.
        </p>
        <div className="lp-hero-actions">
          <Link href="/login" className="lp-btn lp-btn-primary">
            Log in to the console <Icon name="arrowRight" size={17} />
          </Link>
          <a href="#how" className="lp-btn lp-btn-ghost">
            See how it works
          </a>
        </div>
        <p className="lp-hero-note">
          Demo instance with synthetic merchant data. Reviewer sign-in details are in the{" "}
          <a className="inline" href="#reviewers">For reviewers</a> section.
        </p>

        <div className="lp-cue" aria-hidden="true">
          <i /> Scroll
        </div>

        <Reveal className="lp-stats" as="div" y={30}>
          <div className="lp-stat">
            <div className="n"><CountUp value={3} /></div>
            <div className="l">recovery scenarios, one engine</div>
          </div>
          <div className="lp-stat">
            <div className="n"><CountUp value={9} /></div>
            <div className="l">failure causes it tells apart</div>
          </div>
          <div className="lp-stat">
            <div className="n green"><CountUp value={100} suffix="%" /></div>
            <div className="l">of actions written to an audit log</div>
          </div>
          <div className="lp-stat">
            <div className="n"><CountUp value={0} /></div>
            <div className="l">paid APIs needed to run it</div>
          </div>
        </Reveal>
      </header>

      {/* ---------------- the gap ---------------- */}
      <section>
        <Reveal>
          <p className="lp-eyebrow">The gap</p>
          <h2>Most recovery work never gets done</h2>
          <p className="lead">
            When a payment fails, the customer usually meant to pay. But chasing every
            drop-off by hand doesn&apos;t scale, generic &ldquo;your payment failed&rdquo;
            blasts get ignored, and finance teams write off the long tail. The money is
            recoverable — it just needs a fast, correct, bounded follow-up.
          </p>
        </Reveal>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section id="how">
        <Reveal>
          <p className="lp-eyebrow">How it works</p>
          <h2>What happens to a failed payment</h2>
          <p>
            Every case moves through the same six stages. A person only steps in when the
            engine is unsure or the amount is large — otherwise it runs on its own, and
            stops the moment a policy limit is reached.
          </p>
        </Reveal>

        <Reveal className="lp-pipe" as="div">
          {STAGES.map((s, i) => (
            <div key={s.name} className={`lp-step ${s.name === "Recover" ? "is-recover" : ""}`}>
              <div className="lp-step-ic">
                <Icon name={s.icon} size={24} />
              </div>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.name}</h3>
              <p>{s.copy}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ---------------- worked example ---------------- */}
      <section>
        <div className="lp-example">
          <Reveal>
            <p className="lp-eyebrow">A case, start to finish</p>
            <h2>You can read every decision it made</h2>
            <p>
              One real case from the demo instance: a checkout that dropped off at payment.
              The engine matched the decline code to <code>INSUFFICIENT_FUNDS</code> at 95%
              confidence, scheduled a retry link, wrote the email from a template, and sent
              it through Brevo — then a reviewer confirmed the customer had paid.
            </p>
            <p>
              Nothing in that chain is a black box. Each line carries a reason code, an
              actor, and a before/after snapshot, and the whole thing exports to CSV.
            </p>
          </Reveal>

          <Reveal y={30}>
            <TiltCard>
              <div className="lp-casefile" aria-label="Example case file">
                <div className="cf-head" data-depth="2">
                  <div>
                    <div className="cf-name">Sara Nair</div>
                    <div className="cf-sub">QuickCart India · checkout drop-off</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="cf-amount">₹2,488.82</div>
                    <span className="lp-badge">
                      <Icon name="recover" size={12} /> Recovered
                    </span>
                  </div>
                </div>

                <div className="lp-cf-meta" data-depth="2">
                  <div><div className="k">Cause</div><div className="v">INSUFFICIENT_FUNDS</div></div>
                  <div><div className="k">Confidence</div><div className="v">0.95 · rule engine</div></div>
                  <div><div className="k">Action</div><div className="v">RETRY_LINK</div></div>
                  <div><div className="k">Payment link</div><div className="v">plink_TVz7tlOP…</div></div>
                </div>

                <ol className="lp-timeline" data-depth="1">
                  <li>
                    <div className="ev">Recovery event ingested — case opened.</div>
                    <div className="meta">system · → DETECTED</div>
                  </li>
                  <li>
                    <div className="ev">Classified as INSUFFICIENT_FUNDS by rule engine (0.95).</div>
                    <div className="meta">system · DETECTED → DIAGNOSED</div>
                  </li>
                  <li>
                    <div className="ev">Scheduled RETRY_LINK with a Razorpay Payment Link.</div>
                    <div className="meta">system · DIAGNOSED → ACTION_SCHEDULED</div>
                  </li>
                  <li>
                    <div className="ev">Draft message generated from template (email).</div>
                    <div className="meta">system · draft_created</div>
                  </li>
                  <li>
                    <div className="ev">Message delivered — ref &lt;…@smtp-relay.mailin.fr&gt;.</div>
                    <div className="meta">system · ACTION_SCHEDULED → ACTION_SENT</div>
                  </li>
                  <li className="human">
                    <div className="ev">Reviewer marked the case recovered — ₹2,488.82.</div>
                    <div className="meta">human · ACTION_SENT → RECOVERED</div>
                  </li>
                </ol>
              </div>
            </TiltCard>
          </Reveal>
        </div>
      </section>

      {/* ---------------- situations ---------------- */}
      <section id="situations">
        <Reveal>
          <p className="lp-eyebrow">What it handles</p>
          <h2>Three situations, one recovery engine</h2>
          <p>
            The same detect–diagnose–decide loop covers all three. Each scenario adds its
            own cause codes, policies, and message templates — not a separate system.
          </p>
        </Reveal>

        <div className="lp-grid-3">
          {SCENARIOS.map((s, i) => (
            <Reveal key={s.kicker} className="lp-card" delay={i * 90}>
              <div className="lp-card-ic"><Icon name={s.icon} size={22} /></div>
              <div className="kicker">{s.kicker}</div>
              <h3>{s.title}</h3>
              <p>{s.copy}</p>
              <div className="codes">
                {s.codes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- guardrails ---------------- */}
      <section id="guardrails">
        <Reveal>
          <p className="lp-eyebrow">Where it stops</p>
          <h2>It stays inside the lines you draw</h2>
          <p>
            Recovery is only useful if merchants trust it near their customers and their
            money. Every limit below is configuration, editable per cause code on the
            Policies screen, and applied on the next run.
          </p>
        </Reveal>

        <div className="lp-guards">
          {GUARDS.map((g, i) => (
            <Reveal key={g.title} className="lp-guard" delay={i * 60}>
              <div className="lp-guard-ic"><Icon name={g.icon} size={20} /></div>
              <div>
                <h3>{g.title}</h3>
                <p>{g.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- for reviewers ---------------- */}
      <section id="reviewers">
        <Reveal>
          <p className="lp-eyebrow">For reviewers &amp; judges</p>
          <h2>Sign in and follow the money</h2>
          <p>
            A buildathon build on a demo instance — the merchants, customers and failed
            payments are synthetic. Sign in with any account below (all use the password{" "}
            <code>recover123</code>) and the console opens on the recovery summary.
          </p>
        </Reveal>

        <Reveal className="lp-review" as="div">
          <div>
            <h3>Reviewer accounts</h3>
            <div className="lp-creds">
              <div><span className="u">admin@recover.test</span> <span className="p">· full access</span></div>
              <div><span className="u">reviewer@recover.test</span> <span className="p">· approve / reject</span></div>
              <div><span className="u">viewer@recover.test</span> <span className="p">· read only</span></div>
            </div>
            <p style={{ marginTop: "16px", fontSize: "0.85rem" }}>
              Prefer to read first? A written walk-through ships with the repo at{" "}
              <code>docs/testing/recover-overview.html</code>.
            </p>
          </div>

          <ul className="lp-checks">
            {CHECKS.map((c) => (
              <li key={c.q} className="lp-check">
                <span className="lp-check-ic"><Icon name={c.icon} size={19} /></span>
                <div>
                  <div className="q">{c.q}</div>
                  <div className="a">{c.a}</div>
                  <span className="path">{c.path}</span>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* ---------------- the bar / cta ---------------- */}
      <section className="lp-bar">
        <Reveal>
          <p className="lp-eyebrow" style={{ justifyContent: "center" }}>The bar for Track 03</p>
          <h2>Explainable, bounded, gated — with the audit trail to prove it.</h2>
          <p>
            That&apos;s the brief. Recover is built around it: a rules-first diagnosis, one
            policy-bounded action, a human in the loop where it matters, and a record of
            every step.
          </p>
          <div className="lp-bar-actions">
            <Link href="/login" className="lp-btn lp-btn-primary">
              Log in to the console <Icon name="arrowRight" size={17} />
            </Link>
            <a href="#how" className="lp-btn lp-btn-ghost">Back to the top of the story</a>
          </div>
        </Reveal>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span>Recover · a Razorpay AI Buildathon submission · Track 03</span>
          <span>
            <Link href="/login">Log in</Link> &nbsp;·&nbsp; <a href="#how">How it works</a>{" "}
            &nbsp;·&nbsp; <a href="#reviewers">Reviewer access</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
