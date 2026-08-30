import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans, Schibsted_Grotesk } from "next/font/google";
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

export default function LandingPage() {
  return (
    <div className={`lp ${display.variable} ${body.variable} ${mono.variable}`}>

      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-wordmark">
            <span className="dot" aria-hidden="true" />
            Recover
          </Link>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#situations">What it handles</a>
            <a href="#guardrails">Guardrails</a>
            <a href="#reviewers">For reviewers</a>
          </div>
          <Link href="/login" className="lp-btn lp-btn-primary">
            Log in
          </Link>
        </div>
      </nav>

      <div className="lp-container">
        {/* ---------------- hero ---------------- */}
        <header className="lp-hero">
          <p className="tagline">Razorpay AI Buildathon · Track 03</p>
          <h1>
            A failed payment is money you <span className="accent">already earned</span>.
          </h1>
          <p className="sub">
            Recover watches your Razorpay payment stream for the ones that didn&apos;t go
            through — a card that expired, a bank balance that was short, a subscription
            mandate that lapsed, an invoice that slipped past its due date — works out why,
            and runs one careful, policy-bounded attempt to get it back. Every step is
            written down.
          </p>
          <div className="lp-hero-actions">
            <Link href="/login" className="lp-btn lp-btn-primary">
              Log in to the console
            </Link>
            <a href="#how" className="lp-btn lp-btn-ghost">
              See how it works
            </a>
          </div>
          <p className="lp-hero-note">
            Demo instance with synthetic merchant data. Reviewer sign-in details are in the{" "}
            <a className="inline" href="#reviewers">
              For reviewers
            </a>{" "}
            section below.
          </p>

          <div className="lp-stats">
            <div className="lp-stat">
              <div className="n">3</div>
              <div className="l">recovery scenarios, one engine</div>
            </div>
            <div className="lp-stat">
              <div className="n">9</div>
              <div className="l">failure causes it tells apart</div>
            </div>
            <div className="lp-stat">
              <div className="n green">100%</div>
              <div className="l">of actions written to an audit log</div>
            </div>
            <div className="lp-stat">
              <div className="n">0</div>
              <div className="l">paid APIs needed to run it</div>
            </div>
          </div>
        </header>

        {/* ---------------- problem ---------------- */}
        <section>
          <p className="lp-eyebrow">The gap</p>
          <h2>Most recovery work never gets done</h2>
          <p className="lead">
            When a payment fails, the customer usually meant to pay. But chasing every
            drop-off by hand doesn&apos;t scale, generic &ldquo;your payment failed&rdquo;
            blasts get ignored, and finance teams end up writing off the long tail. The
            money is recoverable — it just needs someone (or something) to follow up
            quickly, correctly, and within sensible limits.
          </p>
        </section>

        {/* ---------------- how it works ---------------- */}
        <section id="how">
          <p className="lp-eyebrow">How it works</p>
          <h2>What happens to a failed payment</h2>
          <p>
            Every case moves through the same six stages. A person only steps in when the
            engine is unsure or the amount is large — otherwise it runs on its own, and
            stops the moment a policy limit is reached.
          </p>

          <div className="lp-pipe">
            <div className="lp-step">
              <h3>Detect</h3>
              <p>A <code>payment.failed</code> webhook, an abandoned checkout, or an invoice past due opens a case.</p>
            </div>
            <div className="lp-step">
              <h3>Diagnose</h3>
              <p>A rules table maps the Razorpay error code to a cause. Unclear ones fall back to local similarity, never a guess.</p>
            </div>
            <div className="lp-step">
              <h3>Decide</h3>
              <p>The policy for that cause picks one action and mints a real Razorpay Payment Link for it.</p>
            </div>
            <div className="lp-step">
              <h3>Draft</h3>
              <p>A template fills in the real name, amount and link — no invented facts, no hallucinated numbers.</p>
            </div>
            <div className="lp-step">
              <h3>Send</h3>
              <p>The message goes out over email (Brevo), with the provider&apos;s delivery reference recorded.</p>
            </div>
            <div className="lp-step is-recover">
              <h3>Recover</h3>
              <p>When the customer pays, the amount and the time-to-recovery are logged against the case.</p>
            </div>
          </div>
        </section>

        {/* ---------------- worked example ---------------- */}
        <section>
          <p className="lp-eyebrow">A case, start to finish</p>
          <div className="lp-example">
            <div>
              <h2>You can read every decision it made</h2>
              <p>
                This is one real case from the demo instance: a checkout that dropped off
                at the payment step. The engine matched the bank&apos;s decline code to
                <code>INSUFFICIENT_FUNDS</code> with 95% confidence, scheduled a retry link,
                wrote the email from a template, and sent it through Brevo — then a reviewer
                confirmed the customer had paid.
              </p>
              <p>
                Nothing in that chain is a black box. Each line carries a reason code, an
                actor, and a before/after snapshot, and the whole thing exports to CSV from
                the case page.
              </p>
            </div>

            <div className="lp-casefile" aria-label="Example case file">
              <div className="cf-head">
                <div>
                  <div className="cf-name">Sara Nair</div>
                  <div className="cf-sub">QuickCart India · checkout drop-off</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="cf-amount">₹2,488.82</div>
                  <span className="lp-badge">Recovered</span>
                </div>
              </div>

              <div className="lp-cf-meta">
                <div>
                  <div className="k">Cause</div>
                  <div className="v">INSUFFICIENT_FUNDS</div>
                </div>
                <div>
                  <div className="k">Confidence</div>
                  <div className="v">0.95 · rule engine</div>
                </div>
                <div>
                  <div className="k">Action</div>
                  <div className="v">RETRY_LINK</div>
                </div>
                <div>
                  <div className="k">Payment link</div>
                  <div className="v">plink_TVz7tlOPuqkOBs</div>
                </div>
              </div>

              <ol className="lp-timeline">
                <li>
                  <div className="ev">Recovery event ingested — case opened.</div>
                  <div className="meta">system · → DETECTED</div>
                </li>
                <li>
                  <div className="ev">Classified as INSUFFICIENT_FUNDS by rule engine (confidence 0.95).</div>
                  <div className="meta">system · DETECTED → DIAGNOSED</div>
                </li>
                <li>
                  <div className="ev">Orchestrator scheduled RETRY_LINK with a Razorpay Payment Link.</div>
                  <div className="meta">system · DIAGNOSED → ACTION_SCHEDULED</div>
                </li>
                <li>
                  <div className="ev">Draft message generated from template (email).</div>
                  <div className="meta">system · draft_created</div>
                </li>
                <li>
                  <div className="ev">Message delivered — provider ref &lt;…@smtp-relay.mailin.fr&gt;.</div>
                  <div className="meta">system · ACTION_SCHEDULED → ACTION_SENT</div>
                </li>
                <li className="human">
                  <div className="ev">Reviewer marked the case recovered — ₹2,488.82.</div>
                  <div className="meta">human · ACTION_SENT → RECOVERED</div>
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* ---------------- situations ---------------- */}
        <section id="situations">
          <p className="lp-eyebrow">What it handles</p>
          <h2>Three situations, one recovery engine</h2>
          <p>
            The same detect–diagnose–decide loop covers all three. Each scenario adds its
            own cause codes, its own policies, and its own message templates — not a
            separate system.
          </p>

          <div className="lp-grid-3">
            <div className="lp-card">
              <div className="kicker">Checkout drop-off</div>
              <h3>The customer left at payment</h3>
              <p>
                A card declined, funds were short, an OTP was abandoned, the gateway timed
                out. Recover sends a reassuring retry link — &ldquo;nothing has been
                charged&rdquo; — inside the allowed hours.
              </p>
              <div className="codes">
                <span>CARD_EXPIRED</span>
                <span>INSUFFICIENT_FUNDS</span>
                <span>OTP_ABANDONED</span>
                <span>GATEWAY_TIMEOUT</span>
              </div>
            </div>
            <div className="lp-card">
              <div className="kicker">Failed subscriptions</div>
              <h3>A renewal didn&apos;t go through</h3>
              <p>
                The auto-pay mandate lapsed, expired, or hit a low balance. Recover explains
                that the authorization itself needs re-doing and links straight to it,
                keeping the subscription alive.
              </p>
              <div className="codes">
                <span>MANDATE_LAPSED</span>
                <span>MANDATE_EXPIRED_CARD</span>
                <span>MANDATE_INSUFFICIENT_FUNDS</span>
              </div>
            </div>
            <div className="lp-card">
              <div className="kicker">Overdue invoices</div>
              <h3>A B2B invoice is past due</h3>
              <p>
                A three-tier ladder — a friendly nudge, then a firm reminder, then escalate
                to a human. Large balances always get a person before anything goes out.
              </p>
              <div className="codes">
                <span>INVOICE_OVERDUE</span>
                <span>Tier 1 → Tier 2 → Tier 3</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- guardrails ---------------- */}
        <section id="guardrails">
          <p className="lp-eyebrow">Where it stops</p>
          <h2>It stays inside the lines you draw</h2>
          <p>
            Recovery is only useful if merchants trust it near their customers and their
            money. Every limit below is configuration, editable per cause code on the
            Policies screen, and applied on the next run.
          </p>

          <div className="lp-guards">
            <div>
              <h3>Low confidence goes to a human</h3>
              <p>If the diagnosis scores below the policy threshold, the case is held for review — it is never sent on a guess.</p>
            </div>
            <div>
              <h3>Large amounts go to a human</h3>
              <p>Anything over the review threshold waits for an approval before any outreach leaves the system.</p>
            </div>
            <div>
              <h3>One conversation at a time</h3>
              <p>A per-cause cooldown keeps Recover from contacting the same customer twice in quick succession.</p>
            </div>
            <div>
              <h3>Civil hours only</h3>
              <p>Outreach is pinned to an IST send window per cause code. Nothing goes out at 3am.</p>
            </div>
            <div>
              <h3>A hard attempt cap</h3>
              <p>Once the maximum attempts for a cause are spent, the agent stops and the case is closed or escalated.</p>
            </div>
            <div>
              <h3>No silent actions</h3>
              <p>Every transition — including the agent&apos;s own — writes a reason and an actor before it takes effect.</p>
            </div>
          </div>
        </section>

        {/* ---------------- for reviewers ---------------- */}
        <section id="reviewers">
          <p className="lp-eyebrow">For reviewers &amp; judges</p>
          <h2>Sign in and follow the money</h2>
          <p>
            This is a buildathon build on a demo instance — the merchants, customers and
            failed payments are synthetic. Sign in with any of the accounts below (all use
            the password <code>recover123</code>) and the console opens on the recovery
            summary.
          </p>

          <div className="lp-review">
            <div>
              <h3>Reviewer accounts</h3>
              <div className="lp-creds">
                <div>
                  <span className="u">admin@recover.test</span> <span className="p">· recover123 · full access</span>
                </div>
                <div>
                  <span className="u">reviewer@recover.test</span> <span className="p">· recover123 · approve / reject</span>
                </div>
                <div>
                  <span className="u">viewer@recover.test</span> <span className="p">· recover123 · read only</span>
                </div>
              </div>
              <p style={{ marginTop: "16px", fontSize: "0.85rem" }}>
                Prefer to read first? A one-page written walk-through of the system ships
                with the repo at <code>docs/testing/recover-overview.html</code>.
              </p>
            </div>

            <ul className="lp-checks">
              <li>
                <div className="q">Is it explainable?</div>
                <div className="a">Open any case and read the audit timeline: cause, confidence, the scheduled action, the draft, the delivery reference.</div>
                <span className="path">Cases → open a row → Audit timeline</span>
              </li>
              <li>
                <div className="q">Is it bounded?</div>
                <div className="a">Change a cooldown on the Policies screen, reload, see it stick. Then open the Approvals queue to see what the agent declined to act on, and why.</div>
                <span className="path">Policies → edit → reload · then Approvals</span>
              </li>
              <li>
                <div className="q">Is the audit trail real?</div>
                <div className="a">On a case page, click Download Audit Trail (CSV) and check a row against the on-screen timeline and the delivery provider reference.</div>
                <span className="path">Cases → open a row → Download Audit Trail (CSV)</span>
              </li>
              <li>
                <div className="q">Is recovery actually measured?</div>
                <div className="a">Note &ldquo;Total recovered&rdquo; on the summary, mark a sent case recovered, come back — the figure moves by exactly that amount and average time-to-recovery updates.</div>
                <span className="path">Summary → a sent case → Mark Recovered → Summary</span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span>Recover · a Razorpay AI Buildathon submission · Track 03</span>
          <span>
            <Link href="/login">Log in</Link> &nbsp;·&nbsp;{" "}
            <a href="#how">How it works</a> &nbsp;·&nbsp;{" "}
            <a href="#reviewers">Reviewer access</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
