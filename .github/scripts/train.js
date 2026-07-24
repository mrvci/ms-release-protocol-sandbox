// Release-train state engine for the sandbox mock.
// One open issue (label: release-train) is the single source of truth per train.
// State lives as JSON inside an HTML comment in the issue body; every workflow
// mutates the state and re-renders the whole body from it. ALL DATA IS FAKE.

const TRAIN_LABEL = 'release-train';
const RELEASED_LABEL = 'released';

const SHARED_STAGES = [
  { key: 'dev-complete', label: 'Dev-complete confirmation', owner: 'Devs / Release Mgr' },
  { key: 'ld-gate', label: 'LD merge gate', owner: 'Dev + Level Design' },
  { key: 'preflight-build', label: 'Pre-flight & candidate build', owner: 'Release Mgr' },
  { key: 'ccd-prod', label: 'CCD → Production', owner: 'Release Mgr / Tech' },
  { key: 'close-train', label: 'Close train (merge + next RC)', owner: 'Dev' },
];

const PLATFORM_STAGES = [
  { key: 'qa', label: 'QA sign-off', owner: 'QA' },
  { key: 'submit', label: 'Store submission', owner: 'Release Mgr' },
  { key: 'rollout', label: 'Rollout', owner: 'Release Mgr' },
];

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function branchNames(version, type) {
  if (type === 'hotfix') {
    return { rc: `releases/rc_v${version}`, ld: null };
  }
  const majorMinor = version.split('.').slice(0, 2).join('.');
  return { rc: `releases/rc_v${majorMinor}.XX`, ld: `level-design/ld_v${majorMinor}.XX` };
}

function newState(version, type) {
  const stages = {};
  for (const s of SHARED_STAGES) {
    stages[s.key] = { status: 'pending', meta: '', at: '', by: '' };
  }
  for (const s of PLATFORM_STAGES) {
    for (const p of ['android', 'ios']) {
      stages[`${s.key}-${p}`] = { status: 'pending', meta: '', at: '', by: '' };
    }
  }
  stages['dev-complete'].status = 'active';
  stages['dev-complete'].meta = 'collecting dev confirmations — expected 1–2 days';
  if (type === 'hotfix') {
    stages['ld-gate'].status = 'na';
    stages['ld-gate'].meta = 'not applicable for hotfix trains';
  }
  return {
    version,
    type,
    trainStatus: 'active',
    branches: branchNames(version, type),
    builds: { android: '—', ios: '—' },
    rollout: { android: 0, ios: '—' },
    stages,
    timeline: [],
  };
}

function icon(stage) {
  if (stage.status === 'done') { return '✅'; }
  if (stage.status === 'active') { return '🟡'; }
  if (stage.status === 'na') { return '➖'; }
  return '⬜';
}

function cellText(stage) {
  const parts = [icon(stage)];
  if (stage.meta) { parts.push(stage.meta); }
  if (stage.status === 'done' && stage.by) { parts.push(`— @${stage.by}, ${stage.at}`); }
  return parts.join(' ');
}

function rolloutBar(percent) {
  const filled = Math.round(percent / 10);
  return '`' + '▓'.repeat(filled) + '░'.repeat(10 - filled) + '` ' + percent + '%';
}

function renderBody(state) {
  const trainIcon = state.trainStatus === 'released' ? '🏁' : state.type === 'hotfix' ? '🔥' : '🟢';
  const lines = [];
  lines.push(`**Type:** ${state.type} · **Status:** ${trainIcon} ${state.trainStatus.toUpperCase()}`);
  const branchBits = ['**RC branch:** `' + state.branches.rc + '`'];
  if (state.branches.ld) { branchBits.push('**LD branch:** `' + state.branches.ld + '`'); }
  lines.push(branchBits.join(' · '));
  lines.push(`**Candidate builds:** Android \`${state.builds.android}\` · iOS \`${state.builds.ios}\``);
  lines.push('');
  lines.push('> Single source of truth for this train, maintained by the release workflows — do not edit by hand.');
  lines.push('> The train starts at **code freeze** — the dev window is pre-train.');
  lines.push('> **Pace targets:** dev-complete 1–2 days → build + QA + CCD ≤ 1 day total → store review & rollout run multi-day on their own clocks.');
  lines.push('> ⚠️ **Sandbox:** every value on this page is mock data.');
  lines.push('');
  lines.push('## Shared stages');
  lines.push('');
  lines.push('| Stage | Owner | Status |');
  lines.push('|---|---|---|');
  for (const s of SHARED_STAGES) {
    lines.push(`| ${s.label} | ${s.owner} | ${cellText(state.stages[s.key])} |`);
  }
  lines.push('');
  lines.push('## Platform lanes');
  lines.push('');
  lines.push('| Stage | Owner | Android | iOS |');
  lines.push('|---|---|---|---|');
  for (const s of PLATFORM_STAGES) {
    const a = state.stages[`${s.key}-android`];
    const i = state.stages[`${s.key}-ios`];
    let aText = cellText(a);
    let iText = cellText(i);
    if (s.key === 'rollout') {
      if (state.rollout.android > 0) { aText = `${icon(a)} ${rolloutBar(state.rollout.android)}`; }
      if (state.rollout.ios !== '—') { iText = `${icon(i)} ${state.rollout.ios}`; }
    }
    lines.push(`| ${s.label} | ${s.owner} | ${aText} | ${iText} |`);
  }
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  for (const t of state.timeline) {
    lines.push(`- **${t.at}** — @${t.by} — ${t.what}`);
  }
  lines.push('');
  lines.push('<!-- train-state');
  lines.push(JSON.stringify(state));
  lines.push('-->');
  return lines.join('\n');
}

function parseState(body) {
  const match = body.match(/<!-- train-state\n([\s\S]*?)\n-->/);
  if (!match) { throw new Error('No train-state block found in issue body.'); }
  return JSON.parse(match[1]);
}

async function ensureLabels(github, context) {
  const defs = [
    { name: TRAIN_LABEL, color: '0e7a72', description: 'Release-train tracking issue' },
    { name: RELEASED_LABEL, color: '35843f', description: 'Train fully released and closed' },
  ];
  for (const d of defs) {
    try {
      await github.rest.issues.createLabel({ ...context.repo, ...d });
    } catch (e) {
      if (e.status !== 422) { throw e; } // 422 = already exists
    }
  }
}

async function findTrain(github, context, version) {
  const { data: issues } = await github.rest.issues.listForRepo({
    ...context.repo, state: 'open', labels: TRAIN_LABEL, per_page: 50,
  });
  const issue = version
    ? issues.find((i) => i.title.includes(version))
    : issues[0];
  if (!issue) {
    throw new Error(version
      ? `No open train issue found for version "${version}".`
      : 'No open train issue found. Run "Release · 01 — Start train" first.');
  }
  return issue;
}

function logTimeline(state, actor, what) {
  state.timeline.unshift({ at: nowStamp(), by: actor, what });
  state.timeline = state.timeline.slice(0, 60);
}

function mark(state, key, actor, status, meta) {
  const stage = state.stages[key];
  stage.status = status;
  stage.meta = meta || stage.meta;
  stage.at = nowStamp();
  stage.by = actor;
}

async function saveTrain(github, context, issue, state) {
  await github.rest.issues.update({
    ...context.repo, issue_number: issue.number, body: renderBody(state),
  });
}

function summary(core, title, rows) {
  let md = `### ${title}\n\n_All values below are **mock data** — this is the M1 look-and-feel sandbox._\n\n`;
  md += rows.map((r) => `- ${r}`).join('\n');
  return core.summary.addRaw(md).write();
}

// ---------------------------------------------------------------------------
// Actions — one per workflow. Dispatched via the ACTION env var.
// ---------------------------------------------------------------------------

const actions = {

  async 'start-train'({ github, context, core }, env) {
    const version = env.VERSION || '1.17.00';
    const type = env.TRAIN_TYPE === 'hotfix' ? 'hotfix' : 'release';
    await ensureLabels(github, context);
    const state = newState(version, type);
    logTimeline(state, context.actor, `train started (${type})`);
    const title = type === 'hotfix'
      ? `🔥 Hotfix train — v${version}`
      : `🚦 Release train — v${version}`;
    const { data: issue } = await github.rest.issues.create({
      ...context.repo, title, labels: [TRAIN_LABEL], body: renderBody(state),
    });
    await summary(core, `Train started — v${version} (${type})`, [
      `Tracking issue: #${issue.number}`,
      `RC branch: \`${state.branches.rc}\` (created at the end of the previous sprint)`,
      state.branches.ld ? `LD branch: \`${state.branches.ld}\`` : 'No LD branch (hotfix)',
      'Code freeze declared — the train has started. The dev window is pre-train.',
      'First gate: dev-complete confirmation (expected to take 1–2 days).',
    ]);
    core.notice(`Train issue created: #${issue.number}`);
  },

  async 'dev-complete'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    mark(state, 'dev-complete', context.actor, 'done', 'all release dev finished & merged');
    logTimeline(state, context.actor,
      'dev-complete confirmed — all development for this release is finished and merged into the RC');
    await saveTrain(github, context, issue, state);
    await summary(core, 'Dev-complete confirmation', [
      'Every dev confirmed their work for this release is finished and merged into the RC (mock).',
      'This is the gate where the train intentionally waits 1–2 days while confirmations come in.',
      `Approved via the \`dev-complete\` environment — recorded with approver, timestamp, and commit SHA.`,
    ]);
  },

  async 'ld-gate'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    if (state.stages['ld-gate'].status === 'na') {
      core.warning('LD gate is N/A for hotfix trains — nothing to do.');
      return;
    }
    mark(state, 'ld-gate', context.actor, 'done', 'LD contained in RC · designers confirmed');
    logTimeline(state, context.actor, 'LD merge gate passed (ancestry ✓, designers confirmed)');
    await saveTrain(github, context, issue, state);
    await summary(core, 'LD merge gate', [
      `\`git merge-base --is-ancestor ${state.branches.ld} ${state.branches.rc}\` → **contained** ✓ (mock)`,
      'Missing commits: **0** (mock)',
      'Designer confirmation: level design confirms LD is final for this sprint ✓ (mock)',
    ]);
  },

  async 'preflight-build'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    state.builds.android = env.ANDROID_BUILD || '637';
    state.builds.ios = env.IOS_BUILD || '632';
    mark(state, 'preflight-build', context.actor, 'done',
      `gates green · builds ${state.builds.android}/${state.builds.ios}`);
    logTimeline(state, context.actor,
      `pre-flight passed, candidate builds triggered on VGCI — Android ${state.builds.android}, iOS ${state.builds.ios}`);
    await saveTrain(github, context, issue, state);
    await summary(core, 'Pre-flight gates & candidate build', [
      `LD merged into RC: **PASS** (mock)${state.type === 'hotfix' ? ' — N/A (hotfix)' : ''}`,
      `bundleVersion == ${state.version}: **PASS** (mock)`,
      'Open P0/P1 Linear issues on this release: **0** (mock)',
      'Tier-1 checks green on RC head: **PASS** (mock)',
      'Addressables gates (dup bundle / atlas drift / labels / deps) on VGCI: **PASS**, 1 advisory (mock)',
      'Merged LD levels enrolled in Addressables: **PASS** (mock)',
      'LiveOps calendar aligned (offers validated + publish scheduled): **confirmed** (mock)',
      'Store metadata ready (notes, screenshots, rollout plan): **confirmed** (mock)',
      `→ VGCI \`unity-build\` triggered (mock): Android \`${state.builds.android}\`, iOS \`${state.builds.ios}\` · durations 42m / 47m (mock)`,
    ]);
  },

  async 'qa'({ github, context, core }, env) {
    const platform = env.PLATFORM;
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    const build = state.builds[platform];
    mark(state, `qa-${platform}`, context.actor, 'done', `build ${build} approved`);
    logTimeline(state, context.actor, `QA sign-off (${platform}) approved for build ${build}`);
    await saveTrain(github, context, issue, state);
    await summary(core, `QA sign-off — ${platform}`, [
      `Build under test: \`${build}\` (mock)`,
      'Smoke suite on device farm: **green** (mock)',
      'Release-notes diff reviewed against the QA ticket (mock)',
      `Approved via the \`qa-signoff-${platform}\` environment — recorded with approver, timestamp, and commit SHA.`,
    ]);
  },

  async 'submit'({ github, context, core }, env) {
    const platform = env.PLATFORM;
    const step = env.STEP;
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    const build = state.builds[platform];
    const store = platform === 'android' ? 'Google Play' : 'App Store';
    if (step === 'submit-for-review') {
      mark(state, `submit-${platform}`, context.actor, 'active', `in ${store} review`);
      logTimeline(state, context.actor, `build ${build} submitted to ${store} review`);
      await saveTrain(github, context, issue, state);
      await summary(core, `Store submission — ${platform}`, [
        `Build \`${build}\` submitted to **${store}** for review (mock).`,
        'Run this workflow again with step = stores-approved once the store approves.',
      ]);
    } else {
      mark(state, `submit-${platform}`, context.actor, 'done', `${store} approved`);
      logTimeline(state, context.actor, `${store} review approved for build ${build}`);
      await saveTrain(github, context, issue, state);
      await summary(core, `Store review approved — ${platform}`, [
        `**${store}** approved build \`${build}\` (mock). Rollout unlocked once CCD is promoted.`,
      ]);
    }
  },

  async 'ccd-prod'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    mark(state, 'ccd-prod', context.actor, 'done',
      `badges pinned — iOS ${state.builds.ios} / Android ${state.builds.android}`);
    logTimeline(state, context.actor,
      `CCD content promoted dev → prod, badges pinned (iOS ${state.builds.ios} / Android ${state.builds.android})`);
    await saveTrain(github, context, issue, state);
    await summary(core, 'CCD → Production', [
      'Remote-content release promoted dev → prod, both platforms (mock).',
      `Badges re-pinned: iOS \`${state.builds.ios}\`, Android \`${state.builds.android}\` (mock).`,
      'Player-facing catalog verified post-promotion (mock).',
      'Must complete BEFORE rollout starts — day-one users need prod content.',
    ]);
  },

  async 'rollout-android'({ github, context, core }, env) {
    const percent = parseInt(env.PERCENT, 10);
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    state.rollout.android = percent;
    const done = percent >= 100;
    mark(state, 'rollout-android', context.actor, done ? 'done' : 'active', done ? 'live at 100%' : '');
    logTimeline(state, context.actor, `Android rollout → ${percent}%`);
    await saveTrain(github, context, issue, state);
    await summary(core, `Android rollout → ${percent}%`, [
      `Google Play production track userFraction set to **${percent}%** (mock).`,
      'Crash watch between steps: steady vs previous version (mock).',
      done ? '**Android is fully live.**' : 'Next step: re-run this workflow with the next percentage.',
    ]);
  },

  async 'rollout-ios'({ github, context, core }, env) {
    const action = env.ROLLOUT_ACTION;
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    if (action === 'start-phased-release') {
      state.rollout.ios = 'phased (Apple 7-day curve)';
      mark(state, 'rollout-ios', context.actor, 'active', '');
      logTimeline(state, context.actor, 'iOS phased release started (Apple 7-day curve)');
    } else {
      state.rollout.ios = 'live to all users';
      mark(state, 'rollout-ios', context.actor, 'done', '');
      logTimeline(state, context.actor, 'iOS released to all users');
    }
    await saveTrain(github, context, issue, state);
    await summary(core, `iOS rollout — ${action}`, [
      action === 'start-phased-release'
        ? 'Phased release started. Apple controls the daily curve; you can only pause or release-to-all (mock).'
        : '**iOS is fully live.** (mock)',
    ]);
  },

  async 'close-train'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    const nextRcExists = env.NEXT_RC_EXISTS === 'true';
    const nextVersion = env.NEXT_VERSION || 'next';
    const merges = [
      `Merged \`${state.branches.rc}\` → \`main\` — **direct merge, no PR** (everything on the RC already came through PRs) (mock)`,
      nextRcExists
        ? `\`releases/rc_v${nextVersion}.XX\` already exists → merged \`${state.branches.rc}\` → \`releases/rc_v${nextVersion}.XX\` — direct merge (mock)`
        : `Created \`releases/rc_v${nextVersion}.XX\` + \`level-design/ld_v${nextVersion}.XX\` from the top of \`${state.branches.rc}\` (mock)`,
      `Deleted \`${state.branches.rc}\`${state.branches.ld ? ' and `' + state.branches.ld + '`' : ''} (mock)`,
    ];
    state.trainStatus = 'released';
    mark(state, 'close-train', context.actor, 'done', 'RC merged to main + next RC; branches deleted');
    logTimeline(state, context.actor, `train closed 🎉 — v${state.version} fully released`);
    await saveTrain(github, context, issue, state);
    await github.rest.issues.addLabels({
      ...context.repo, issue_number: issue.number, labels: [RELEASED_LABEL],
    });
    await github.rest.issues.createComment({
      ...context.repo, issue_number: issue.number,
      body: `🏁 **v${state.version} train closed.**\n\n` + merges.map((m) => `- ${m}`).join('\n'),
    });
    await github.rest.issues.update({
      ...context.repo, issue_number: issue.number, state: 'closed', state_reason: 'completed',
    });
    await summary(core, `Close train — v${state.version}`, merges);
  },

  async 'reset-demo'({ github, context, core }) {
    const { data: issues } = await github.rest.issues.listForRepo({
      ...context.repo, state: 'open', labels: TRAIN_LABEL, per_page: 50,
    });
    for (const issue of issues) {
      await github.rest.issues.createComment({
        ...context.repo, issue_number: issue.number, body: '♻️ Closed by reset-demo.',
      });
      await github.rest.issues.update({
        ...context.repo, issue_number: issue.number, state: 'closed', state_reason: 'not_planned',
      });
    }
    await summary(core, 'Reset demo', [`Closed ${issues.length} open train issue(s).`]);
  },
};

module.exports = async function run(ctx) {
  const action = process.env.ACTION;
  if (!actions[action]) { throw new Error(`Unknown ACTION "${action}"`); }
  await actions[action](ctx, process.env);
};
