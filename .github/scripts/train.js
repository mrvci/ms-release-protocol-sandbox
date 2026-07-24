// Release-train state engine for the sandbox mock.
// One open issue (label: release-train) is the single source of truth per train.
// State lives as JSON inside an HTML comment in the issue body; every workflow
// job mutates the state and re-renders the whole body from it. ALL DATA IS FAKE.

const TRAIN_LABEL = 'release-train';
const RELEASED_LABEL = 'released';

const SHARED_STAGES = [
  { key: 'dev-complete', label: 'Dev-complete confirmation', owner: 'Devs / Release Mgr' },
  { key: 'ld-gate', label: 'LD merge gate', owner: 'Dev + Level Design' },
  { key: 'preflight-build', label: 'Pre-flight & candidate build', owner: 'Release Mgr' },
  { key: 'ccd-prod', label: 'CCD → Production', owner: 'Release Mgr / Tech' },
  { key: 'store-metadata', label: 'Store metadata ready', owner: 'Release Mgr' },
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

function renderMermaid(state) {
  const nodes = [
    { id: 'DC', key: 'dev-complete', label: 'Dev-complete' },
    { id: 'LD', key: 'ld-gate', label: 'LD gate' },
    { id: 'PF', key: 'preflight-build', label: 'Pre-flight + Build' },
    { id: 'QAA', key: 'qa-android', label: 'QA Android' },
    { id: 'QAI', key: 'qa-ios', label: 'QA iOS' },
    { id: 'SBA', key: 'submit-android', label: 'Play submission' },
    { id: 'SBI', key: 'submit-ios', label: 'App Store submission' },
    { id: 'CCD', key: 'ccd-prod', label: 'CCD to Prod' },
    { id: 'MD', key: 'store-metadata', label: 'Store metadata' },
    { id: 'ROA', key: 'rollout-android', label: 'Rollout Android' },
    { id: 'ROI', key: 'rollout-ios', label: 'Rollout iOS' },
    { id: 'CL', key: 'close-train', label: 'Close train' },
  ];
  const lines = ['```mermaid', 'flowchart LR'];
  const byStatus = { done: [], active: [], pending: [], na: [] };
  for (const n of nodes) {
    const stage = state.stages[n.key];
    let label = n.label;
    if (n.key === 'rollout-android' && state.rollout.android > 0) { label += ' ' + state.rollout.android + '%'; }
    if (n.key === 'rollout-ios' && state.rollout.ios !== '—') { label += ' · ' + state.rollout.ios; }
    if (stage.status === 'na') { label += ' (N/A)'; }
    lines.push(`  ${n.id}["${label}"]`);
    byStatus[stage.status].push(n.id);
  }
  lines.push('  DC --> LD --> PF');
  lines.push('  PF --> QAA --> SBA --> ROA');
  lines.push('  PF --> QAI --> SBI --> ROI');
  lines.push('  PF --> CCD');
  lines.push('  PF --> MD');
  lines.push('  CCD --> ROA');
  lines.push('  CCD --> ROI');
  lines.push('  MD --> ROA');
  lines.push('  MD --> ROI');
  lines.push('  ROA --> CL');
  lines.push('  ROI --> CL');
  lines.push('  classDef done fill:#1a7f37,stroke:#1a7f37,color:#ffffff');
  lines.push('  classDef active fill:#9a6700,stroke:#9a6700,color:#ffffff');
  lines.push('  classDef pending fill:#57606a,stroke:#57606a,color:#ffffff');
  lines.push('  classDef na fill:#57606a,stroke:#57606a,color:#ffffff,stroke-dasharray:4 4');
  for (const status of Object.keys(byStatus)) {
    if (byStatus[status].length > 0) {
      lines.push(`  class ${byStatus[status].join(',')} ${status}`);
    }
  }
  lines.push('```');
  return lines;
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
  lines.push(...renderMermaid(state));
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

// Terse per-job summary: only what THIS job did. Mock banner once, then facts.
function summary(core, title, rows) {
  let md = `### ${title} · _(mock)_\n\n`;
  md += rows.map((r) => `- ${r}`).join('\n');
  return core.summary.addRaw(md).write();
}

// ---------------------------------------------------------------------------
// Actions — dispatched via the ACTION env var; one per workflow job.
// ---------------------------------------------------------------------------

const actions = {

  async 'start-train'({ github, context, core }, env) {
    const version = env.VERSION || '1.17.00';
    const type = env.TRAIN_TYPE === 'hotfix' ? 'hotfix' : 'release';
    await ensureLabels(github, context);
    const state = newState(version, type);
    logTimeline(state, context.actor, `train started (${type}) — code freeze declared`);
    const title = type === 'hotfix'
      ? `🔥 Hotfix train — v${version}`
      : `🚦 Release train — v${version}`;
    const { data: issue } = await github.rest.issues.create({
      ...context.repo, title, labels: [TRAIN_LABEL], body: renderBody(state),
    });
    await summary(core, `Train started — v${version}`, [
      `Tracking issue: #${issue.number} · RC: \`${state.branches.rc}\``,
    ]);
    core.notice(`Train issue created: #${issue.number}`);
  },

  async 'dev-complete'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    mark(state, 'dev-complete', context.actor, 'done', 'all release dev finished & merged');
    logTimeline(state, context.actor, 'dev-complete confirmed');
    await saveTrain(github, context, issue, state);
    await summary(core, 'Dev-complete', [
      `All devs confirmed release work is merged into the RC — approved by @${context.actor}.`,
    ]);
  },

  async 'ld-gate'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    if (state.stages['ld-gate'].status === 'na') {
      core.warning('LD gate is N/A for hotfix trains — nothing to do.');
      return;
    }
    mark(state, 'ld-gate', context.actor, 'done', 'LD in RC · designers confirmed');
    logTimeline(state, context.actor, 'LD merge gate passed');
    await saveTrain(github, context, issue, state);
    await summary(core, 'LD merge gate', [
      `\`${state.branches.ld}\` contained in \`${state.branches.rc}\` — 0 missing commits. Designers confirmed.`,
    ]);
  },

  async 'preflight-build'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    mark(state, 'preflight-build', context.actor, 'active', 'gates green — awaiting builds');
    logTimeline(state, context.actor, 'pre-flight gates passed');
    await saveTrain(github, context, issue, state);
    await summary(core, 'Pre-flight gates', [
      'All gates green (detail: this run\'s steps above).',
    ]);
  },

  async 'builds-triggered'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    logTimeline(state, context.actor, 'VGCI candidate builds triggered');
    await saveTrain(github, context, issue, state);
    await summary(core, 'Candidate builds triggered', [
      'VGCI `unity-build` dispatched for Android + iOS.',
    ]);
  },

  async 'record-builds'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    state.builds.android = env.ANDROID_BUILD || '—';
    state.builds.ios = env.IOS_BUILD || '—';
    mark(state, 'preflight-build', context.actor, 'done',
      `builds ${state.builds.android}/${state.builds.ios} green`);
    logTimeline(state, context.actor,
      `candidate builds green — Android ${state.builds.android}, iOS ${state.builds.ios}`);
    await saveTrain(github, context, issue, state);
    await summary(core, 'Builds recorded', [
      `Android \`${state.builds.android}\` · iOS \`${state.builds.ios}\`.`,
    ]);
  },

  async 'qa'({ github, context, core }, env) {
    const platform = env.PLATFORM;
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    const build = state.builds[platform];
    mark(state, `qa-${platform}`, context.actor, 'done', `build ${build} approved`);
    logTimeline(state, context.actor, `QA sign-off (${platform}) — build ${build}`);
    await saveTrain(github, context, issue, state);
    await summary(core, `QA sign-off — ${platform}`, [
      `Build \`${build}\` QA-approved by @${context.actor}.`,
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
      logTimeline(state, context.actor, `build ${build} → ${store} review`);
      await saveTrain(github, context, issue, state);
      await summary(core, `Submitted — ${platform}`, [
        `Build \`${build}\` → **${store}** review.`,
      ]);
    } else {
      mark(state, `submit-${platform}`, context.actor, 'done', `${store} approved`);
      logTimeline(state, context.actor, `${store} approved build ${build}`);
      await saveTrain(github, context, issue, state);
      await summary(core, `Store approved — ${platform}`, [
        `**${store}** approved build \`${build}\`.`,
      ]);
    }
  },

  async 'ccd-prod'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    mark(state, 'ccd-prod', context.actor, 'done',
      `badges — iOS ${state.builds.ios} / Android ${state.builds.android}`);
    logTimeline(state, context.actor, 'CCD promoted dev → prod, badges pinned');
    await saveTrain(github, context, issue, state);
    await summary(core, 'CCD → Production', [
      `Promoted dev → prod. Badges pinned: iOS \`${state.builds.ios}\`, Android \`${state.builds.android}\`.`,
    ]);
  },

  async 'store-metadata'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    mark(state, 'store-metadata', context.actor, 'done', 'notes, screenshots, rollout plan');
    logTimeline(state, context.actor, 'store metadata confirmed ready');
    await saveTrain(github, context, issue, state);
    await summary(core, 'Store metadata', [
      `Release notes, screenshots, and rollout plan confirmed by @${context.actor}.`,
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
      done ? '**Android is fully live.**' : `Play production track at **${percent}%**.`,
    ]);
  },

  async 'rollout-ios'({ github, context, core }, env) {
    const action = env.ROLLOUT_ACTION;
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    if (action === 'start-phased-release') {
      state.rollout.ios = 'phased (Apple 7-day curve)';
      mark(state, 'rollout-ios', context.actor, 'active', '');
      logTimeline(state, context.actor, 'iOS phased release started');
    } else {
      state.rollout.ios = 'live to all users';
      mark(state, 'rollout-ios', context.actor, 'done', '');
      logTimeline(state, context.actor, 'iOS live to all users');
    }
    await saveTrain(github, context, issue, state);
    await summary(core, `iOS rollout`, [
      action === 'start-phased-release' ? 'Phased release started.' : '**iOS is fully live.**',
    ]);
  },

  async 'close-train'({ github, context, core }, env) {
    const issue = await findTrain(github, context, env.VERSION);
    const state = parseState(issue.body);
    const nextRcExists = env.NEXT_RC_EXISTS === 'true';
    const nextVersion = env.NEXT_VERSION || 'next';
    const merges = [
      `Merged \`${state.branches.rc}\` → \`main\` (direct merge, no PR).`,
      nextRcExists
        ? `\`releases/rc_v${nextVersion}.XX\` exists → merged \`${state.branches.rc}\` → \`releases/rc_v${nextVersion}.XX\`.`
        : `Created \`releases/rc_v${nextVersion}.XX\` + \`level-design/ld_v${nextVersion}.XX\` from \`${state.branches.rc}\`.`,
      `Deleted \`${state.branches.rc}\`${state.branches.ld ? ' and `' + state.branches.ld + '`' : ''}.`,
    ];
    state.trainStatus = 'released';
    mark(state, 'close-train', context.actor, 'done', 'RC merged to main + next RC');
    logTimeline(state, context.actor, `train closed 🎉 — v${state.version} fully released`);
    await saveTrain(github, context, issue, state);
    await github.rest.issues.addLabels({
      ...context.repo, issue_number: issue.number, labels: [RELEASED_LABEL],
    });
    await github.rest.issues.createComment({
      ...context.repo, issue_number: issue.number,
      body: `🏁 **v${state.version} train closed.**\n\n` + merges.map((m) => `- ${m} _(mock)_`).join('\n'),
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
