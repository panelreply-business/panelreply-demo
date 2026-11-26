'use strict';

// Component cases only. These are not Windows product acceptance or release
// counter entries. Each entry must retain an explicit outcome if setup fails.
const CASES = [
  ['WNS.private_create_roundtrip', 'Private creation, independent descriptor inspection and bounded Unicode/binary readback'],
  ['WNS.exclusive_create_preserves_existing', 'Exclusive directory and file publication preserves existing identities and bytes'],
  ['WNS.root_security_rejection', 'Existing null, empty, inherited or extra-grant DACLs are rejected without repair'],
  ['WNS.different_owner_rejection', 'A token-assignable different owner is rejected without changing ownership'],
  ['WNS.child_security_and_hardlink_rejection', 'Unsafe child DACLs and multiple hard links fail before bytes are returned'],
  ['WNS.path_and_argument_boundaries', 'Path aliases, device/stream/traversal names and invalid input fail without creation'],
  ['WNS.held_parent_rename_barriers', 'Each held disposable ancestor resists rename and becomes renameable after close'],
  ['WNS.attribute_only_reparse_countertest', 'An actual attribute-only reparse attempt has a working unleased control and retained-lease check'],
  ['WNS.existing_reparse_paths_rejected', 'Existing junction roots, intermediate components and children never expose target bytes'],
  ['WNS.concurrent_exclusive_publication', 'Two real processes publish one complete file through exclusive creation'],
  ['WNS.anonymous_io_denial', 'An observed anonymous token reads its control but cannot read the private file, then restores identity'],
  ['WNS.concurrent_writer_read_refusal', 'An actual held writer prevents protected read until the writer closes'],
  ['WNS.lease_receiver_close_and_worker_cleanup', 'Invalid/closed receivers fail and worker teardown releases retained handles'],
  ['WNS.instrumented_relative_create_race', 'A probe observes the child handle and independent directories after a coordinated reparse mutation', true],
  ['WNS.instrumented_probe_cleanup_and_isolation', 'Throwing/closing probe callbacks roll back creation and normal/probe APIs remain separate', true]
].map(([id, purpose, testInstrumented = false]) => Object.freeze({ id, purpose, testInstrumented }));

module.exports = { CASES: Object.freeze(CASES), TEST_FILE: 'tests/windows-storage.windows.cjs' };
