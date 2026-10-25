// Spawned by errors.test.ts: installs the process handlers, then throws (or rejects) once.
import { installProcessHandlers } from '../errors.js';

installProcessHandlers('worker');
if (process.argv[2] === 'reject') {
  void Promise.reject(new Error('rejected: postgresql://robot:fixture-secret@db.test/robot'));
  setTimeout(() => process.exit(0), 1500);
} else {
  setTimeout(() => { throw new Error('crashed: http://u:fixture-secret@gate.test:7000'); }, 10);
}
