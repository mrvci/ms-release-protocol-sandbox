# Marble Sort — Release Protocol Sandbox (M1)

Look-and-feel mock of the release protocol on **native GitHub Actions UI**. No functionality:
every job only writes a terse summary and updates the train tracking issue. **All data is fake.**

## Structure (v2 — after first review)

The first version (one workflow per stage) failed review: too many workflows, no visible
relationship between stages, and re-dispatching with choice inputs produced sibling-blind runs
with skipped jobs. v2 restructures around **3 phase workflows** that match how the train clumps
in time — within a phase, stages are **chained jobs in one run**, so the run page shows a real
DAG and each gate pauses the same run:

| Workflow | What's inside (jobs) | Run lifetime |
|---|---|---|
| `01 — Start train` | creates the train issue (code freeze) | seconds |
| `02 — Phase A · Freeze → Build` | dev-complete → LD gate → pre-flight (checks as steps) → trigger builds | ~1–2 days (dev-complete wait) |
| `03 — Phase B · QA → Store approval` | record builds → per-platform lanes: QA → submit → store-approved | ~1–4 days (store review) |
| `04 — Phase C · Go live → Close` | CCD ∥ store-metadata → Android ramp ladder (10→25→50→100) + iOS phased → close train | ~1 week (rollout) |
| `90 — ONE-RUN TRAIN (experiment)` | the ENTIRE train as one ~20-job DAG in a single run | full train |
| `99 — Reset demo` | closes all open train issues | seconds |

Key properties:

- **One run per phase** — no more parameter re-dispatching. The store submission's two
  sub-steps are two sequential jobs, each with its own approval; nothing shows as skipped.
- **Human gates = environments**: the run pauses amber on the next gate; approving advances it.
  Sequential gates prompt one at a time on the same run page.
- **Pace targets:** dev-complete 1–2 days (the one intentional idle) → build + QA + CCD ≤ 1 day →
  store review & rollout multi-day on their own clocks.
- The **train issue** (label `release-train`) stays the cross-phase source of truth: live Mermaid
  pipeline graph, stage tables, timeline. Train starts at **code freeze**; dev window is pre-train.
- **Store metadata** is a Phase C gate (last thing before rollout) — it never blocks QA.
- Hotfix trains: `train_type: hotfix` at start — LD gate is auto-skipped.

## Demo script

1. **01 — Start train** (`1.17.00`, `release`) → train issue appears.
2. **02 — Phase A** → the run pauses on `dev-complete` → approve → pauses on `ld-confirm` →
   approve → pre-flight checks run as visible steps → builds "triggered". Watch the DAG fill in
   on the run page.
3. **03 — Phase B** (enter build numbers) → both platform lanes appear in one graph; approve
   QA → submit → store-approved per lane, in any order across platforms.
4. **04 — Phase C** → approve CCD and store-metadata → ramp Android 10→25→50→100 (one
   approval per step) and iOS phased → close-train runs the ceremony and closes the issue 🎉.
5. **90 — ONE-RUN TRAIN** → the same protocol as ONE run; judge which feels better.
6. **99 — Reset demo** to start over.

Between approvals, check the **train issue** (graph + tables) and the **Deployments** page.

## Environments & target approvers

| Environment | Gate | Approver role |
|---|---|---|
| `dev-complete` | All release dev finished & merged (1–2 day idle) | Devs / Release Mgr |
| `ld-confirm` | LD merged + designers confirm final | Level Design |
| `builds-green` | (experiment only) VGCI builds are green | Release Mgr |
| `qa-signoff-android` / `-ios` | QA pass per platform | QA |
| `store-submission-android` / `-ios` | Submit to store review | Release Mgr / Store owner |
| `store-approved-android` / `-ios` | Store review verdict recorded | Release Mgr / Store owner |
| `ccd-production` | Remote-content promotion | Tech / Release Mgr |
| `store-metadata` | Notes/screenshots/rollout plan ready (pre-rollout) | Release Mgr |
| `rollout-android` / `-ios` | Each rollout step | Release Mgr / Store owner |

## What this maps to in the real build (M2+)

| Here (fake) | Real implementation |
|---|---|
| Pre-flight steps | Tier-1 text checks (GHA) + `-executeMethod` Unity gates as a VGCI job |
| "Trigger VGCI" job | CircleCI API call + completion webhook → `repository_dispatch` advances Phase B automatically |
| Build numbers | CircleCI API (webhook payload) instead of manual input |
| LD ancestry step | Real `git merge-base --is-ancestor` |
| QA references | Linear API — auto-create/update the QA issue per candidate build |
| CCD badge pins | Existing CCD promotion tooling behind the `ccd-production` approval |
| Close-train steps | Real direct merges (RC → main, RC → next RC), branch create/delete |

## Experiment notes (workflow 90)

The one-run train buys a single living DAG for the whole release, at known costs:
a **rejected** gate fails the run (recover via *Re-run failed jobs* — succeeded jobs keep their
results), loops (re-QA after a fix) don't exist in a DAG, and the run must live for the whole
train (GitHub caps a run at 35 days; each pending approval times out after 30). The phase
split (02/03/04) is the hedge: same approvals, three shorter DAGs, natural restart points.

## MSTECH-1570 — duplicate-bundle PR gate (first real workload)

Goal: run `AddressablesDuplicateBundleCheck.RunForCI` on marblesort PRs that touch
addressables/offer/skin content, so the culprit commit is named at review time
(the `/trigger-build` pre-flight only catches it post-merge).

**Status & the one blocker.** Everything is written; the blocker is a Unity license
reachable from GitHub-hosted runners. Voodoo's CI licensing is a licensing server
local to the CircleCI machines (per #vgci-support) — GHA can't use it. The sanctioned
path is a dedicated license from Voodoo IT. Once secrets exist here, run
**Proof · 95 — Unity license in GHA**: a green run retires the blocker.

- `unity-proof/` — minimal Unity `6000.3.16f1` project (version read from
  ProjectVersion.txt) with a `CIProbe.Run` -executeMethod probe.
- `game-repo/addressables-duplicate-check.yml` — the ready-to-install marblesort
  workflow: path-scoped `pull_request` trigger, Library cache, GameCI android image,
  fail-closed semantics (exit 2 = could-not-analyze fails), PR failure comment, and
  an allowlist-watch job that flags allowlist edits for reviewers.

Fallbacks if a dedicated license is refused: run the check as a custom VGCI job
(ask #vgci-support; licensing already solved there, but PR-time triggering and
status reporting get more complex), or a self-hosted runner with an existing seat.
