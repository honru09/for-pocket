import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const bash = process.env.TEST_BASH || (process.platform === 'win32' ? ['D:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find(existsSync) : 'bash');
const haveBash = bash && spawnSync(bash, ['--version'], { encoding: 'utf8' }).status === 0;
const haveJq = haveBash && spawnSync(bash, ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;

const fakeGcloud = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), s = JSON.parse(fs.readFileSync(process.env.MOCK_REMINDER_STATE, 'utf8'));
const value = name => args.find(x => x.startsWith(name + '='))?.slice(name.length + 1);
const flags = value('--flags-file') ? JSON.parse(fs.readFileSync(value('--flags-file'), 'utf8')) : {};
const prefix = (...words) => words.every((word, i) => args[i] === word);
const emit = v => process.stdout.write(JSON.stringify(v));
const save = () => fs.writeFileSync(process.env.MOCK_REMINDER_STATE, JSON.stringify(s));
if (JSON.stringify(args).includes('fixture-private-secret')) throw new Error('secret exposed in command arguments');
s.calls.push(args);
if (prefix('run','services','describe')) emit(s.service);
else if (prefix('run','services','get-iam-policy')) emit({bindings:[{role:'roles/run.invoker',members:['allUsers']}]});
else if (prefix('services','list')) emit(s.apis.map(name => ({config:{name}})));
else if (prefix('scheduler','jobs','list')) emit(s.jobs);
else if (prefix('tasks','queues','list')) emit(s.queues);
else if (prefix('services','enable')) { s.apis.push(...args.slice(2).filter(x=>!x.startsWith('--'))); }
else if (prefix('tasks','queues','create')) { s.queues.push({name:'projects/fixture-project/locations/asia-northeast1/queues/'+args[3],state:'RUNNING'}); }
else if (prefix('tasks','queues','add-iam-policy-binding')) { s.queueMember=value('--member'); s.queueRole=value('--role'); }
else if (prefix('run','services','update')) {
  if (args.some(x=>/^--(set-env-vars|env-vars-file|clear-env-vars)/.test(x))) throw new Error('destructive env replacement');
  const env=s.service.spec.template.spec.containers[0].env;
  for(const [name,value] of Object.entries(flags['--update-env-vars'])) { const old=env.find(v=>v.name===name); if(old) Object.assign(old,{value}); else env.push({name,value}); }
  s.runUpdates++;
} else if (prefix('scheduler','jobs','create','http') || prefix('scheduler','jobs','update','http')) {
  let job=s.jobs.find(x=>x.name.endsWith('/'+args[4]));
  if(!job) {job={name:'projects/fixture-project/locations/asia-northeast1/jobs/'+args[4],httpTarget:{headers:{}},state:'ENABLED'};s.jobs.push(job);}
  Object.assign(job.httpTarget,{uri:value('--uri'),httpMethod:value('--http-method'),headers:{...job.httpTarget.headers,...flags['--headers'],...flags['--update-headers']}});
  job.schedule=value('--schedule'); job.timeZone=value('--time-zone');
} else if(prefix('scheduler','jobs','describe')) emit(s.jobs.find(x=>x.name.endsWith('/'+args[3])));
else if(prefix('scheduler','jobs','resume')) s.jobs.find(x=>x.name.endsWith('/'+args[3])).state='ENABLED';
else throw new Error('Unexpected gcloud command: '+args.slice(0,4).join(' '));
save();
`;

function state({ secret = true, existingJob = false } = {}) {
  return { apis: [], queues: [], calls: [], runUpdates: 0,
    service: { metadata: {}, spec: { template: { spec: { serviceAccountName: 'pocket@fixture-project.iam.gserviceaccount.com', containers: [{ image: 'unchanged-image', env: [
      { name: 'BOT_TOKEN', value: 'untouched-bot-token' }, { name: 'PUBLIC_URL', value: 'https://pocket.example' }, { name: 'VERTEX_PROJECT_ID', value: 'fixture-project' },
      ...(secret ? [{ name: 'CRON_SECRET', value: 'fixture-private-secret-keep-this' }] : []),
    ] }], volumes: [{ name: 'existing-data', csi: { driver: 'gcsfuse.run.googleapis.com' } }] } } }, status: { url: 'https://pocket.example' } },
    jobs: existingJob ? [{ name: 'projects/fixture-project/locations/asia-northeast1/jobs/preexisting-tick', state: 'ENABLED', schedule: '0 * * * *', httpTarget: { uri: 'https://pocket.example/api/cron/tick', headers: { 'X-Keep': 'keep-me' }, oidcToken: { serviceAccountEmail: 'already-configured@fixture-project.iam.gserviceaccount.com' } } }] : [],
  };
}

test('reminder setup dry-run is offline and does not print sensitive state', { skip: !haveBash }, () => {
  const result = spawnSync(bash, ['scripts/setup-reminders.sh', '--dry-run'], { cwd: root, encoding: 'utf8', env: { ...process.env, PROJECT: 'fixture-project' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no cloud calls/);
  assert.match(result.stdout, /\*\/15/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-private-secret/);
});

test('reminder setup safely creates resources, preserves configuration, and is repeatable using only a mock gcloud', { skip: !haveJq }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'for-reminder-setup-test-'));
  t.after(async () => { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('for-reminder-setup-test-')); await rm(dir, { recursive: true, force: true }); });
  const mock = path.join(dir, 'gcloud'), fixturePath = path.join(dir, 'fixture.json');
  await writeFile(mock, fakeGcloud); await chmod(mock, 0o700);
  const invoke = () => spawnSync(bash, ['scripts/setup-reminders.sh', '--apply'], { cwd: root, encoding: 'utf8', env: { ...process.env, PROJECT: 'fixture-project', REGION: 'asia-northeast1', SERVICE: 'for-pocket', MOCK_REMINDER_STATE: fixturePath, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
  for (const scenario of [{ secret: true }, { secret: false }, { secret: true, existingJob: true }]) {
    const initial = state(scenario);
    if (scenario.existingJob) initial.apis.push('cloudscheduler.googleapis.com');
    await writeFile(fixturePath, JSON.stringify(initial));
    const first = invoke();
    assert.equal(first.status, 0, JSON.stringify(scenario) + '\n' + first.stdout + first.stderr);
    assert.doesNotMatch(first.stdout + first.stderr, /fixture-private-secret|untouched-bot-token/);
    let updated = JSON.parse(await readFile(fixturePath, 'utf8'));
    const env = Object.fromEntries(updated.service.spec.template.spec.containers[0].env.map(x => [x.name, x.value]));
    assert.equal(env.BOT_TOKEN, 'untouched-bot-token');
    assert.equal(updated.service.spec.template.spec.containers[0].image, 'unchanged-image');
    assert.equal(updated.service.spec.template.spec.volumes[0].name, 'existing-data');
    assert.equal(env.REACTION_TASKS_QUEUE, 'for-pocket-reactions');
    assert.equal(updated.queueRole, 'roles/cloudtasks.enqueuer');
    assert.equal(updated.queueMember, 'serviceAccount:pocket@fixture-project.iam.gserviceaccount.com');
    assert.equal(updated.jobs.length, 1); assert.equal(updated.queues.length, 1);
    assert.equal(updated.jobs[0].schedule, '*/15 * * * *');
    assert.equal(updated.jobs[0].httpTarget.headers['X-Cron-Secret'], env.CRON_SECRET);
    if (scenario.secret) assert.equal(env.CRON_SECRET, 'fixture-private-secret-keep-this'); else assert.match(env.CRON_SECRET, /^[a-f0-9]{64}$/);
    if (scenario.existingJob) { assert.ok(updated.jobs[0].name.endsWith('preexisting-tick')); assert.equal(updated.jobs[0].httpTarget.headers['X-Keep'], 'keep-me'); assert.ok(updated.jobs[0].httpTarget.oidcToken); }
    const second = invoke(); assert.equal(second.status, 0, second.stdout + second.stderr);
    updated = JSON.parse(await readFile(fixturePath, 'utf8'));
    assert.equal(updated.jobs.length, 1); assert.equal(updated.queues.length, 1); assert.equal(updated.runUpdates, 1);
    assert.equal(updated.service.spec.template.spec.containers[0].env.find(x => x.name === 'CRON_SECRET').value, env.CRON_SECRET);
  }
});
