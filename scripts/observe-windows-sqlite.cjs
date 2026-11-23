'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { sourceEvidence, platformEvidence } = require('./test-evidence.cjs');
const { inspectBuild, loadCandidate, PINS, ARTIFACTS } = require('../workspace/native/windows-storage/load.cjs');
const { fixture, selectNtfsParent } = require('../tests/windows-storage-support.cjs');
const { spawnObserver } = require('../tests/windows-sqlite-observer-process.cjs');
const { DATABASE, FILES, DATA, SCENARIOS, equalData, forcedExitObserved, emptyScenario, setPhase, finishScenario,
  sameWindowsPath, validateToken, fileObservation } = require('../tests/windows-sqlite-observation-support.cjs');
const ROOT = path.resolve(__dirname, '..');

function argumentsFor(args) {
  const options = { buildFailed: false }, seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (seen.has(name)) throw new Error('Repeated observation argument: ' + name);
    seen.add(name);
    if (['--build-directory', '--output'].includes(name) && args[index + 1] && !args[index + 1].startsWith('--')) {
      options[name === '--output' ? 'output' : 'buildDirectory'] = path.resolve(args[++index]);
    } else if (name === '--build-failed') options.buildFailed = true;
    else throw new Error('Usage: node scripts/observe-windows-sqlite.cjs --build-directory DIR --output FILE [--build-failed]');
  }
  if (!options.buildDirectory || !options.output || !options.output.endsWith('.json')) throw new Error('Use a component build directory and explicit JSON observation output.');
  const relative = path.relative(ROOT, options.output);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && !relative.startsWith('artifacts' + path.sep)) {
    throw new Error('Keep generated observation reports outside the source tree or in artifacts/.');
  }
  if (path.basename(options.output).startsWith('release-')) throw new Error('SQLite observations cannot masquerade as release evidence.');
  return options;
}
const detail = error => ({ message: String(error.message || error).slice(0, 4000), code: error.code || null,
  ...(error.observationCategory ? { category: error.observationCategory } : {}),
  ...(error.observation ? { observation: error.observation } : {}) });
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function nodeImage(filename) {
  const real = fs.realpathSync(filename), expected = fs.realpathSync(process.execPath), stat = fs.statSync(real);
  if (!sameWindowsPath(real, expected) || !stat.isFile() || stat.size < 1 || stat.size > 256 * 1024 * 1024) throw new Error('The child process image is not the pinned Node file.');
  const sha256 = hash(real);
  if (sha256 !== PINS.nodeExecutableSha256) throw new Error('The observed Node image file differs from its reviewed byte pin.');
  return { path: real, sha256, bytes: stat.size, scope: 'Executable file identity, not mapped-page measurement.' };
}
function verifyLive(session, startup, executable, phase, when) {
  try {
    session.live();
    if (!startup || startup.node.pid !== session.child.pid || startup.portableHarness !== false
        || startup.node.version !== PINS.node || startup.node.platform !== 'win32' || startup.node.architecture !== 'x64'
        || startup.node.sha256 !== PINS.nodeExecutableSha256 || !sameWindowsPath(startup.node.execPath, process.execPath)) {
      throw new Error('The owned IPC child did not report the pinned Windows Node process.');
    }
    validateToken(startup.token, { pid: session.child.pid, imagePath: process.execPath });
    const native = fixture(executable, ['process-token', String(session.child.pid), startup.token.creationFiletime]);
    validateToken(native, { pid: session.child.pid, imagePath: process.execPath,
      creationFiletime: startup.token.creationFiletime, token: startup.token });
    const image = nodeImage(native.imagePath);
    session.live();
    const observation = { phase, when, native, image, observedAt: new Date().toISOString() };
    if (session.record.tokenObservations.length >= 32) throw new Error('The owned-child token observation bound was exceeded.');
    session.record.tokenObservations.push(observation);
    return native;
  } catch (error) { error.observationCategory = 'PROCESS_OR_IMAGE_IDENTITY'; throw error; }
}

function snapshot(out, directory, lease, executable, token, strict) {
  // The child is paused at an IPC boundary. These path-based metadata queries
  // are separate observations, not an atomic snapshot or reparse-race proof.
  out.directory = lease.inspect();
  out.directoryMetadata = fixture(executable, ['info', directory]);
  out.listingBefore = fs.readdirSync(directory).sort();
  if (out.listingBefore.length > FILES.length || out.listingBefore.some(name => !FILES.includes(name))) throw new Error('An unplanned file appeared in the disposable SQLite directory.');
  if (out.directoryMetadata.fileId !== out.directory.fileId || out.directoryMetadata.volumeSerial !== out.directory.volumeSerial) {
    throw new Error('The native directory observations disagree about fixture identity.');
  }
  out.files = [];
  for (const name of FILES) {
    const native = fixture(executable, ['info', path.join(directory, name)], { allowFailure: true });
    const file = fileObservation(name, out.listingBefore, native);
    if (file.status === 'PRESENT' && token) {
      file.ownerMatchesNodeUser = native.ownerSid === token.userSid;
      file.ownerMatchesNodeDefaultOwner = native.ownerSid === token.defaultOwnerSid;
    }
    out.files.push(file);
  }
  out.listingAfter = fs.readdirSync(directory).sort();
  if (JSON.stringify(out.listingBefore) !== JSON.stringify(out.listingAfter)) throw new Error('SQLite directory entries changed during a paused observation.');
  if (strict) {
    out.strictInspection = [];
    for (const file of out.files.filter(item => item.status === 'PRESENT')) {
      try { out.strictInspection.push({ name: file.name, result: 'ACCEPTED', metadata: lease.inspectFile(file.name) }); }
      catch (error) {
        const rejected = ['WRONG_OWNER', 'UNSAFE_DACL'].includes(error.code);
        out.strictInspection.push({ name: file.name, result: rejected ? 'REJECTED' : 'ERROR', ...detail(error) });
        if (!rejected) throw error;
      }
    }
  }
}
function requireObservedFiles(out, mode) {
  const required = mode === 'WAL' ? [DATABASE, DATABASE + '-wal', DATABASE + '-shm'] : [DATABASE, DATABASE + '-journal'];
  if (required.some(name => !out.files.some(file => file.name === name && file.status === 'PRESENT'))) {
    throw new Error('The intended open-transaction files were not observed.');
  }
}

async function observeScenario(spec, record, candidate, root, deadline, append) {
  const sessions = [];
  let lease = null, directory = null, currentPhase = null, lastToken = null;
  async function phase(id, action) {
    currentPhase = id;
    const row = record.phases.find(item => item.id === id);
    row.startedAt = new Date().toISOString(); row.observation = {};
    try {
      if (performance.now() >= deadline) throw new Error('The bounded observation run reached its deadline.');
      await action(row.observation);
      setPhase(record, id, { status: 'OBSERVED', completedAt: new Date().toISOString() });
    } catch (error) {
      setPhase(record, id, { status: 'ERROR', completedAt: new Date().toISOString(), error: detail(error) });
      throw error;
    } finally { append({ scenario: spec.id, phase: row }); }
  }
  async function start(role) {
    const session = spawnObserver({ directory, mode: spec.mode, role, fixtureExecutable: candidate.fixtureExecutable });
    sessions.push(session); record.children.push(session.record);
    const ready = await session.ready;
    lastToken = verifyLive(session, ready, candidate.fixtureExecutable, currentPhase, 'ready');
    return { session, ready };
  }
  async function request(actor, command, type, id) {
    lastToken = verifyLive(actor.session, actor.ready, candidate.fixtureExecutable, id, 'before-command');
    const response = await actor.session.request(command, type);
    lastToken = verifyLive(actor.session, actor.ready, candidate.fixtureExecutable, id, 'after-command');
    return response;
  }
  function files(out, strict = false) {
    try { snapshot(out, directory, lease, candidate.fixtureExecutable, lastToken, strict); }
    catch (error) { error.observationCategory = 'FILE_METADATA_OR_STRICT_INSPECTION'; throw error; }
  }
  try {
    await phase('prepared', out => {
      directory = path.join(root, spec.id.replaceAll('/', '-'));
      record.directory = directory;
      lease = candidate.addon.createPrivateDirectory(directory);
      out.createdDirectory = lease.inspect();
      if (spec.creation === 'precreated') out.precreatedFile = lease.createFile(DATABASE, Buffer.alloc(0));
      // A creation lease retains DELETE for rollback. Close it explicitly before
      // a new normal lease or a SQLite process traverses this directory.
      lease.close(); lease = null;
      lease = candidate.addon.openPrivateDirectory(directory);
      files(out, true);
      const main = out.files.find(item => item.name === DATABASE);
      if (spec.creation === 'precreated' ? main.status !== 'PRESENT' || main.metadata.bytes !== 0 : main.status !== 'ABSENT') {
        throw new Error('The initial main-file state differs from the creation scenario.');
      }
    });
    let writer;
    await phase('opened', async out => {
      writer = await start('writer'); out.child = await request(writer, 'open', 'opened', 'opened'); files(out);
    });
    await phase('baseline-committed', async out => {
      out.child = await request(writer, 'baseline', 'baseline-committed', 'baseline-committed');
      if (!equalData(out.child.data, 'baseline')) throw new Error('The committed synthetic baseline did not match.');
      files(out);
    });
    await phase('transaction-open', async out => {
      out.child = await request(writer, 'begin', 'transaction-open', 'transaction-open');
      if (!equalData(out.child.data, 'committed')) throw new Error('The uncommitted synthetic changes did not match.');
      files(out); requireObservedFiles(out, spec.mode);
    });
    if (spec.ending === 'close') {
      await phase('committed', async out => {
        out.child = await request(writer, 'commit', 'committed', 'committed');
        if (!equalData(out.child.data, 'committed')) throw new Error('The explicit commit did not preserve the synthetic changes.');
        files(out);
      });
      await phase('closed', async out => { out.child = await request(writer, 'close', 'closed', 'closed'); files(out, true); });
      await phase('writer-exited', async out => {
        lastToken = verifyLive(writer.session, writer.ready, candidate.fixtureExecutable, 'writer-exited', 'before-exit');
        out.child = await writer.session.request('exit', 'exiting'); out.exit = await writer.session.waitExit();
        if (out.exit.code !== 0 || out.exit.signal !== null) throw new Error('The closed writer did not exit normally.');
        files(out, true);
      });
    } else await phase('writer-terminated', async out => {
      lastToken = verifyLive(writer.session, writer.ready, candidate.fixtureExecutable, 'writer-terminated', 'before-owned-child-kill');
      out.exit = await writer.session.terminate('requested crash after uncommitted write');
      out.termination = writer.session.record.termination;
      if (out.termination?.reason !== 'requested crash after uncommitted write' || !out.termination.requestAccepted || !forcedExitObserved(out.exit)) {
        throw new Error('The requested forced termination was not observed.');
      }
      files(out, true);
    });
    let recovery;
    await phase('reopened', async out => {
      recovery = await start('recovery'); out.child = await request(recovery, 'open', 'reopened', 'reopened');
      if (!equalData(out.child.data, spec.ending === 'close' ? 'committed' : 'baseline')) throw new Error('SQLite recovery returned unexpected committed or uncommitted rows.');
      files(out);
    });
    await phase('recovery-closed', async out => { out.child = await request(recovery, 'close', 'closed', 'recovery-closed'); files(out, true); });
    await phase('recovery-exited', async out => {
      lastToken = verifyLive(recovery.session, recovery.ready, candidate.fixtureExecutable, 'recovery-exited', 'before-exit');
      out.child = await recovery.session.request('exit', 'exiting'); out.exit = await recovery.session.waitExit();
      if (out.exit.code !== 0 || out.exit.signal !== null) throw new Error('The recovery reader did not exit normally.');
      files(out, true);
    });
  } catch (error) { record.errors.push({ stage: currentPhase || 'scenario-setup', ...detail(error) }); }
  finally {
    for (const session of sessions) {
      const cleanup = await session.cleanup();
      if (cleanup.status !== 'OBSERVED') record.errors.push({ stage: 'owned-child-cleanup', ...cleanup });
    }
    let leaseClosed = true;
    if (lease) { try { lease.close(); } catch (error) { leaseClosed = false; record.errors.push({ stage: 'lease-cleanup', ...detail(error) }); } }
    record.cleanup = { status: leaseClosed && sessions.every(item => item.record.cleanup.status === 'OBSERVED') ? 'OBSERVED' : 'ERROR',
      leaseClosed, childrenClosed: sessions.every(item => !!item.record.closed), directoryDeletion: 'Deferred until run cleanup.' };
    finishScenario(record, 'An earlier phase or prerequisite did not complete.');
    append({ scenario: spec.id, status: record.status, cleanup: record.cleanup, errors: record.errors });
  }
}

async function main(args) {
  const options = argumentsFor(args), records = SCENARIOS.map(emptyScenario), failures = [];
  const report = { format: 'panelreply-windows-sqlite-observation-v1', suite: 'windows-sqlite-observation',
    status: 'INCOMPLETE', acceptance: 'NOT_ESTABLISHED', releaseCredit: false, productPassing: 0,
    startedAt: new Date().toISOString(), platform: platformEvidence(), spec: { ...DATA, main: DATABASE, files: FILES },
    scenarios: records, infrastructureErrors: failures, buildFailed: options.buildFailed,
    nativeIdentity: null, nativeIdentityAfter: null, nativeRuntimeChanged: null, probeLoaded: false,
    cleanup: { status: 'NOT_RUN', reason: 'No disposable run fixture was created.' },
    limitations: ['Inactive diagnostic only. No Windows product or native-storage adapter acceptance.',
      'Forced process termination is not a power-loss, machine-crash or storage durability experiment.',
      'Metadata calls are separate path observations at a paused child boundary, not an atomic snapshot or reparse-race proof.',
      'Token evidence is the fixed non-impersonating child primary token, not arbitrary thread-token or standard-user acceptance.',
      'Executable hashes identify pinned image files, not the process mapped executable pages.',
      'Full temp-file, sidecar-recreation, custom VFS and restore-publication requirements remain open.'] };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  report.observationsPath = options.output.replace(/\.json$/, '.observations.jsonl');
  if (fs.existsSync(options.output) || fs.existsSync(report.observationsPath)) throw new Error('Preserve existing observations by choosing a new output path.');
  fs.writeFileSync(report.observationsPath, '', { flag: 'wx' });
  let logBytes = 0;
  const append = value => {
    const line = JSON.stringify(value) + '\n'; logBytes += Buffer.byteLength(line);
    if (logBytes > 16 * 1024 * 1024) throw new Error('The observation log exceeded its bound.');
    fs.appendFileSync(report.observationsPath, line);
  };
  let candidate = null, root = null, before = null;
  const deadline = performance.now() + 180000;
  try {
    before = sourceEvidence(ROOT); Object.assign(report, before);
    if (options.buildFailed) throw new Error('The native build did not complete. No SQLite scenario was run.');
    if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('This fixed diagnostic requires no Node preload/module-path overrides.');
    candidate = loadCandidate(options.buildDirectory, before);
    report.nativeIdentity = candidate.identity;
    report.usedArtifacts = candidate.identity.observed.filter(item => [ARTIFACTS[0], ARTIFACTS[2]].includes(item.name));
    report.probeLoaded = false;
    report.fixtureParent = selectNtfsParent(candidate.fixtureExecutable);
    root = fs.mkdtempSync(path.join(report.fixtureParent.path, 'panelreply-windows-sqlite-'));
    report.fixtureRoot = root;
    for (let index = 0; index < SCENARIOS.length; index++) {
      if (performance.now() >= deadline) throw new Error('The bounded SQLite observation run reached its deadline.');
      await observeScenario(SCENARIOS[index], records[index], candidate, root, deadline, append);
      if (records[index].cleanup.status !== 'OBSERVED') throw new Error('A prior scenario retained an owned child or directory lease.');
    }
  } catch (error) { failures.push({ stage: candidate ? 'fixture-or-run' : 'build-or-loader', ...detail(error), ...(error.attempts ? { attempts: error.attempts } : {}) }); }
  finally {
    if (candidate) {
      try {
        report.nativeIdentityAfter = inspectBuild(options.buildDirectory, before);
        report.nativeRuntimeChanged = candidate.identity.manifestSha256 !== report.nativeIdentityAfter.manifestSha256
          || JSON.stringify(candidate.identity.observed) !== JSON.stringify(report.nativeIdentityAfter.observed);
        if (report.nativeRuntimeChanged) throw new Error('The native build or artifact identity changed during observation.');
      } catch (error) { report.nativeRuntimeChanged = true; failures.push({ stage: 'native-identity-after', ...detail(error) }); }
    }
    if (root) {
      try {
        if (records.some(item => item.cleanup.status === 'ERROR')) throw new Error('Keep the disposable fixture because an owned child/lease cleanup remains unverified.');
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 0 });
        if (fs.existsSync(root)) throw new Error('The disposable SQLite fixture remains after cleanup.');
        report.cleanup = { status: 'OBSERVED', fixtureRemoved: true };
      } catch (error) { report.cleanup = { status: 'ERROR', fixtureRemoved: false, ...detail(error) }; failures.push({ stage: 'fixture-cleanup', ...detail(error) }); }
    }
    try {
      const after = sourceEvidence(ROOT);
      report.sourceTreeSha256After = after.sourceTreeSha256;
      report.sourceChanged = !before || before.sourceCommit !== after.sourceCommit || before.sourceTreeSha256 !== after.sourceTreeSha256;
      if (report.sourceChanged) throw new Error('The source identity changed or was unavailable during observation.');
    } catch (error) { report.sourceChanged = true; failures.push({ stage: 'source-identity-after', ...detail(error) }); }
  }
  for (const record of records) finishScenario(record, failures.length ? 'A run prerequisite or infrastructure failure prevented this phase.' : undefined);
  report.totals = { observed: records.filter(item => item.status === 'OBSERVED').length,
    errors: records.filter(item => item.status === 'ERROR').length, notRun: records.filter(item => item.status === 'NOT_RUN').length };
  if (report.totals.observed === SCENARIOS.length && !failures.length && report.cleanup.status === 'OBSERVED'
      && report.nativeIdentityAfter && !report.sourceChanged && !report.nativeRuntimeChanged) report.status = 'OBSERVATIONS_COMPLETE';
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: options.output, status: report.status, totals: report.totals,
    infrastructureErrors: failures.length, acceptance: report.acceptance, releaseCredit: false, productPassing: 0 }));
  if (report.status !== 'OBSERVATIONS_COMPLETE') process.exitCode = 1;
  return report;
}

module.exports = { argumentsFor, verifyLive, snapshot, requireObservedFiles, observeScenario, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
