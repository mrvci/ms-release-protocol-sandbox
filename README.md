# Marble Sort — Release Protocol Sandbox (M1)

Look-and-feel mock of the release protocol on **native GitHub Actions UI**. No functionality:
every workflow only writes a job summary and updates the train tracking issue. **All data is fake.**

The goal of M1: click through a full release as each role and judge whether the native GHA
experience (Actions tab, approval modal, Deployments tab, the train issue) is acceptable —
before building anything real.

## How a train works

- The train starts at **code freeze** — the dev window is pre-train background, not a stage.
- **Pace targets:** the dev-complete gate is the one place the train intentionally idles
  (1–2 days collecting confirmations). From pre-flight through CCD the target is ≤ 1 day total.
  Store review and gradual rollout run multi-day on their own clocks.
- One release = one **train issue** (label `release-train`) — the single source of truth.
  Every workflow rewrites its stage table + timeline. Don't edit it by hand.
- Stages are **separate short workflow runs**, not one long-lived run. Human gates are
  GitHub **environments with required reviewers**: the run pauses with a *Review deployments*
  prompt until an approver clicks. Any one listed approver is enough (OR semantics).
- Platform lanes: Android and iOS proceed independently from QA sign-off onward
  (Android usually releases first; iOS follows days later).
- Hotfix trains: start the train with `train_type: hotfix` — the LD gate is skipped (N/A).

## Demo script (the intended click path)

1. **Actions → Release · 01 — Start train** → Run workflow (`1.17.00`, `release`) → code freeze declared, the train issue appears under Issues with the dev-complete gate active.
2. **02 — Dev-complete gate** → run it → **pauses for approval** — this is the gate where the real train idles 1–2 days while every dev confirms their release work is finished and merged.
3. **03 — LD merge gate** → run it → issue updates (in real life: `git merge-base --is-ancestor` + designer confirmation).
4. **04 — Pre-flight & candidate build** → run it → read the job summary: the full gate table (addressables gates, version bump, P0/P1, LD ancestry…), then the fake VGCI trigger.
5. **05 — QA sign-off (Android)** → run it → the run **pauses, amber, "Waiting for review"** → open the run → **Review deployments** → approve with a comment. This is the core UX moment. Repeat 06 for iOS whenever you like — lanes are independent.
6. **07 — Store submission (Android)** with `submit-for-review` (pauses for approval) → later re-run with `stores-approved`. 08 = iOS, days later.
7. **09 — CCD → Production** → approval → badges "pinned" (must precede any rollout).
8. **10 — Rollout (Android)** at 10 → 25 → 50 → 100 (each ramp = one approval). **11 — Rollout (iOS)**: start phased / release-to-all (Apple owns the daily curve).
9. **12 — Close train** → merges RC → `main` + next RC (direct merges, no PRs), creates or reuses `rc_v1.18.XX`/`ld_v1.18.XX`, deletes the closed branches — all faked in the summary — and closes the issue 🎉.
10. **99 — Reset demo** closes all open trains so you can start over.

Also check the **Deployments** page (repo sidebar) after a few approvals — that's the native
per-environment history view.

## Environments & target approvers

Environment names are live in this repo (Settings → Environments). Approver *roles* below;
the actual people are configured as required reviewers in repo settings, not in files.

| Environment | Gate | Approver role |
|---|---|---|
| `dev-complete` | All release dev finished & merged (the train's 1–2 day idle point) | Devs / Release Mgr |
| `qa-signoff-android` / `-ios` | QA pass per platform | QA |
| `store-submission-android` / `-ios` | Submit to store review | Release Mgr / Store owner |
| `ccd-production` | Remote-content promotion | Tech / Release Mgr |
| `rollout-android` / `-ios` | Each rollout ramp | Release Mgr / Store owner |

## What this maps to in the real build (M2+)

| Here (fake) | Real implementation |
|---|---|
| Pre-flight gate table | Tier-1 text checks (GHA) + `-executeMethod` Unity gates run as a VGCI job, results reported back |
| "Trigger VGCI" line | CircleCI API call (the MSTECH-187 pattern) + completion webhook → `repository_dispatch` |
| Build numbers/durations | CircleCI API (token already exists for triggering) |
| QA ticket references | Linear API — auto-create/update the QA issue per candidate build |
| "What's in this build" | PR titles between build SHAs, enriched with Linear ticket titles; PR-title lint as a Tier-1 check |
| CCD badge pins | The existing CCD promotion tooling behind the `ccd-production` approval |
| LD gate | Real `git merge-base --is-ancestor` + designer confirmation |
| Close-train ceremony | Real direct merges (RC → main, RC → next RC), branch create/delete |

Deliberately out of scope in M1: Slack notifications, Linear integration, rollout %/review-state
fetching from the stores, and any ordering enforcement (you can run stages out of order — it's a mock).
