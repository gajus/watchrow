import { Logger } from './Logger';
import findProcess from 'find-process';
import { setTimeout as delay } from 'node:timers/promises';
import pidTree from 'pidtree';

const log = Logger.child({
  namespace: 'killPsTree',
});

export const killPsTree = async (
  rootPid: number,
  gracefulTimeout: number = 30_000,
) => {
  let pids: number[] = [];

  try {
    pids = await pidTree(rootPid, {
      root: true,
    });
  } catch (error) {
    log.warn({ error }, 'failed to find process tree');

    return false;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code === 'ESRCH') {
        log.debug({ pid }, 'process already terminated');
      } else {
        throw error;
      }
    }
  }

  let hangingPids = [...pids];

  let hitTimeout = false;

  const timeoutId = setTimeout(() => {
    hitTimeout = true;

    log.debug({ hangingPids }, 'sending SIGKILL to processes...');

    for (const pid of hangingPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code === 'ESRCH') {
          log.debug({ pid }, 'process already terminated');
        } else {
          throw error;
        }
      }
    }
  }, gracefulTimeout);

  // eslint-disable-next-line no-unmodified-loop-condition
  while (!hitTimeout && hangingPids.length > 0) {
    for (const hangingPid of hangingPids) {
      const processes = await findProcess('pid', hangingPid);

      if (processes.length === 0) {
        hangingPids = hangingPids.filter((pid) => pid !== hangingPid);
      }
    }

    await delay(100);
  }

  clearTimeout(timeoutId);

  log.debug('all processes terminated');

  return true;
};
