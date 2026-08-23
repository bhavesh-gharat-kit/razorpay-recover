# Recover — Claude Code Build Pack

This is a phase-by-phase prompt pack for building the **Recover** project
(Razorpay AI Buildathon — Track 03: AI Revenue Recovery) using Claude Code.

## What's in here

```
recover-prompts/
├── README.md              <- you are here
├── CLAUDE.md              <- copy to your repo root; Claude Code auto-reads this
├── PROGRESS.md             <- checklist template; update after each phase
└── phases/
    ├── 00-foundation.md
    ├── 01-data-layer.md
    ├── 02-event-ingestion.md
    ├── 03-classification-engine.md
    ├── 04-orchestrator-scheduler.md
    ├── 05-message-generation.md
    ├── 06-channel-adapters.md
    ├── 07-auth-approval-audit.md
    ├── 08-dashboard-checkout-demo.md
    ├── 09-extend-scenarios.md
    └── 10-deployment-hardening.md
```

## How to actually use this

1. **Create your project folder** (e.g. `~/projects/recover`), `cd` into it,
   and run `git init`.
2. **Copy `CLAUDE.md` into the repo root** before you start Phase 00. Claude
   Code reads this automatically at the start of every session — it's your
   project's persistent memory so you don't have to re-explain the
   architecture every time.
3. **Copy `PROGRESS.md` into the repo root too.** You (or Claude Code, if you
   ask it to) update this after every phase.
4. Open Claude Code in that folder (`claude` in the terminal, or the desktop
   app pointed at the folder).
5. **Open `phases/00-foundation.md`, copy its entire contents, and paste it
   as your first message to Claude Code.** Let it work, review what it built,
   run it locally, and confirm it actually works before moving on.
6. Move to `phases/01-data-layer.md` and repeat. **Do this in order — each
   phase assumes the previous ones are done.** You can do this in the same
   Claude Code session (context carries over) or a fresh one each time
   (CLAUDE.md + PROGRESS.md fill the gap) — both work, fresh sessions per
   phase are actually a bit more reliable for keeping Claude Code focused on
   just that phase's scope.
7. At the end of each phase, ask Claude Code: *"Update PROGRESS.md with what
   we just built and anything the next phase needs to know."*

## A few ground rules to get the best results

- **Don't paste two phases at once.** Each prompt is scoped deliberately —
  finishing Phase 3 before Phase 4 exists is what keeps the classification
  engine testable in isolation, for example.
- **Actually run the app between phases.** `npm run dev`, hit the new
  endpoints, look at the database. Catching a problem at the end of Phase 2
  is cheap; catching it at the end of Phase 8 is not.
- **If Claude Code proposes a different library or pattern than the prompt
  specifies, that's fine as long as it doesn't contradict `CLAUDE.md`'s
  non-negotiables** (no Redis, no separate Express service, template-first
  messaging, etc.). Push back if it tries to introduce one of those anyway.
- **Commit your git repo after every phase.** `git add -A && git commit -m
  "Phase 0: foundation"`. If a later phase goes sideways, you can always
  reset to the last good phase.
- **The synthetic data generator (Phase 1) is what makes every later phase
  demoable.** Don't skip it or thin it out — the whole point of this
  project's "bar" is a measured, reproducible batch result.

## Rough time expectations

These are prompts for an experienced full-stack builder guiding Claude Code,
not fully hands-off automation — expect to review, test, and occasionally
redirect at every phase. Phases 0–2 and 6–7 are typically fast (scaffolding
and integration-shaped work); Phases 3–5 and 8–9 are where the actual
"AI revenue recovery" logic lives and deserve the most of your attention and
testing.

## If something breaks

Every phase file has an "Acceptance checklist" near the bottom — if Claude
Code says it's done but an item on that checklist doesn't actually work, tell
it exactly which item failed and paste the error. Don't move to the next
phase until the checklist passes for real, not just "looks right."
