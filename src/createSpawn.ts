// cspell:words nothrow

import { AbortError, UnexpectedError } from './errors';
import { findNearestDirectory } from './findNearestDirectory';
import { killPsTree } from './killPsTree';
import { Logger } from './Logger';
import { type Throttle } from './types';
import chalk from 'chalk';
import randomColor from 'randomcolor';
import { throttle } from 'throttle-debounce';
import { $ } from 'zx';

const log = Logger.child({
  namespace: 'createSpawn',
});

const prefixLines = (subject: string, prefix: string): string => {
  const response: string[] = [];

  for (const fragment of subject.split('\n')) {
    response.push(prefix + fragment);
  }

  return response.join('\n');
};

export const createSpawn = (
  taskId: string,
  {
    cwd = process.cwd(),
    abortSignal,
    throttleOutput,
    triggerName,
    triggerHexColor,
  }: {
    abortSignal?: AbortSignal;
    cwd?: string;
    throttleOutput?: Throttle;
    triggerHexColor?: string;
    triggerName?: string;
  } = {},
) => {
  let stdoutBuffer: string[] = [];
  let stderrBuffer: string[] = [];

  const flush = () => {
    if (stdoutBuffer.length) {
      // eslint-disable-next-line no-console
      console.log(stdoutBuffer.join('\n'));
    }

    if (stderrBuffer.length) {
      // eslint-disable-next-line no-console
      console.error(stderrBuffer.join('\n'));
    }

    stdoutBuffer = [];
    stderrBuffer = [];
  };

  const output = throttle(
    throttleOutput?.delay,
    () => {
      flush();
    },
    {
      noLeading: true,
    },
  );

  const colorText = chalk.hex(
    triggerHexColor || randomColor({ luminosity: 'dark' }),
  );

  return async (pieces: TemplateStringsArray, ...args: any[]) => {
    const binPath = (await findNearestDirectory('node_modules', cwd)) + '/.bin';

    $.cwd = cwd;

    $.prefix = `set -euo pipefail; export PATH="${binPath}:$PATH";`;

    let onStdout: (chunk: Buffer) => void;
    let onStderr: (chunk: Buffer) => void;

    const formatChunk = (chunk: Buffer) => {
      const prefixTriggerName = triggerName ? triggerName + ' ' : '';

      return prefixLines(
        chunk.toString().trimEnd(),
        colorText(`${prefixTriggerName}${taskId}`) + ' > ',
      );
    };

    if (throttleOutput?.delay) {
      onStdout = (chunk: Buffer) => {
        stdoutBuffer.push(formatChunk(chunk));
        output();
      };

      onStderr = (chunk: Buffer) => {
        stderrBuffer.push(formatChunk(chunk));
        output();
      };
    } else {
      onStdout = (chunk: Buffer) => {
        // eslint-disable-next-line no-console
        console.log(formatChunk(chunk));
      };

      onStderr = (chunk: Buffer) => {
        // eslint-disable-next-line no-console
        console.error(formatChunk(chunk));
      };
    }

    if (abortSignal?.aborted) {
      throw new UnexpectedError(
        'Attempted to spawn a process after the task was aborted.',
      );
    }

    // eslint-disable-next-line promise/prefer-await-to-then
    const processPromise = $(pieces, ...args)
      .nothrow()
      .quiet();

    processPromise.stdout.on('data', onStdout);
    processPromise.stderr.on('data', onStderr);

    if (abortSignal) {
      const kill = () => {
        const pid = processPromise.child?.pid;

        if (!pid) {
          log.warn('no process to kill');

          return;
        }

        // TODO make this configurable
        // eslint-disable-next-line promise/prefer-await-to-then
        killPsTree(pid, 5_000).then(() => {
          log.debug('task %s was killed', taskId);

          processPromise.stdout.off('data', onStdout);
          processPromise.stderr.off('data', onStderr);
        });
      };

      abortSignal.addEventListener('abort', kill, {
        once: true,
      });

      // eslint-disable-next-line promise/prefer-await-to-then
      processPromise.finally(() => {
        abortSignal.removeEventListener('abort', kill);
      });
    }

    const result = await processPromise;

    flush();

    if (result.exitCode === 0) {
      return result;
    }

    if (abortSignal?.aborted) {
      throw new AbortError('Program was aborted.');
    }

    log.error('task %s exited with an error', taskId);

    throw new Error('Program exited with code ' + result.exitCode + '.');
  };
};
