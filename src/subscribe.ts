import { createSpawn } from './createSpawn';
import { generateShortId } from './generateShortId';
import { Logger } from './Logger';
import {
  type ActiveTask,
  type FileChangeEvent,
  type Subscription,
  type Trigger,
} from './types';

const log = Logger.child({
  namespace: 'subscribe',
});

/**
 * Creates a trigger evaluation specific abort controller that inherits the abort signal from the trigger.
 * This abort controller is used to abort the the task that is currently running either because the trigger
 * has been interrupted or because the trigger has been triggered again.
 */
const createAbortController = (trigger: Trigger) => {
  const abortController = new AbortController();

  trigger.abortSignal.addEventListener('abort', () => {
    abortController.abort();
  });

  return abortController;
};

const runTask = async ({
  taskId,
  abortController,
  trigger,
  firstEvent,
  changedFiles,
}: {
  abortController: AbortController;
  changedFiles: readonly string[];
  firstEvent: boolean;
  taskId: string;
  trigger: Trigger;
}) => {
  if (trigger.initialRun && firstEvent) {
    log.debug('%s (%s): initial run...', trigger.name, taskId);
  } else if (changedFiles.length > 10) {
    log.debug(
      {
        files: changedFiles.slice(0, 10),
      },
      '%s (%s): %d files changed; showing first 10',
      trigger.name,
      taskId,
      changedFiles.length,
    );
  } else {
    log.debug(
      {
        files: changedFiles,
      },
      '%s (%s): %d %s changed',
      trigger.name,
      taskId,
      changedFiles.length,
      changedFiles.length === 1 ? 'file' : 'files',
    );
  }

  let attempt = -1;

  while (attempt++ < trigger.retry.retries) {
    const retriesLeft = trigger.retry.retries - attempt;

    if (retriesLeft < 0) {
      throw new Error('Expected retries left to be greater than or equal to 0');
    }

    try {
      await trigger.onChange({
        abortSignal: abortController?.signal,
        attempt,
        files: changedFiles.map((changedFile) => {
          return {
            name: changedFile,
          };
        }),
        first: firstEvent,
        log,
        spawn: createSpawn(taskId, {
          abortSignal: abortController?.signal,
          cwd: trigger.cwd,
          throttleOutput: trigger.throttleOutput,
        }),
        taskId,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        log.warn('%s (%s): task aborted', trigger.name, taskId);

        return;
      }

      if (retriesLeft === 0) {
        log.warn(
          '%s (%s): task will not be retried; attempts exhausted',
          trigger.name,
          taskId,
        );

        throw error;
      }

      if (retriesLeft > 0) {
        log.warn(
          '%s (%s): retrying task %d/%d...',
          trigger.name,
          taskId,
          trigger.retry.retries - retriesLeft,
          trigger.retry.retries,
        );

        continue;
      }

      throw new Error('Expected retries left to be greater than or equal to 0');
    }
  }

  throw new Error('Expected while loop to be terminated by a return statement');
};

export const subscribe = (trigger: Trigger): Subscription => {
  /**
   * Indicates that the teardown process has been initiated.
   * This is used to prevent the trigger from being triggered again while the teardown process is running.
   */
  let outerTeardownInitiated = false;

  /**
   * Stores the currently active task.
   */
  let outerActiveTask: ActiveTask | null = null;

  /**
   * Identifies the first event in a series of events.
   */
  let outerFirstEvent = true;

  /**
   * Stores the files that have changed since the last evaluation of the trigger
   */
  let outerChangedFiles: string[] = [];

  const handleSubscriptionEvent = async () => {
    let firstEvent = outerFirstEvent;

    if (outerFirstEvent) {
      firstEvent = true;
      outerFirstEvent = false;
    }

    if (outerActiveTask) {
      if (trigger.interruptible) {
        log.warn('%s (%s): aborted task', trigger.name, outerActiveTask.id);

        if (!outerActiveTask.abortController) {
          throw new Error('Expected abort controller to be set');
        }

        outerActiveTask.abortController.abort();

        outerActiveTask = null;
      } else {
        if (trigger.persistent) {
          log.warn(
            '%s (%s): ignoring event because the trigger is persistent',
            trigger.name,
            outerActiveTask.id,
          );

          return undefined;
        }

        log.warn(
          '%s (%s): waiting for task to complete',
          trigger.name,
          outerActiveTask.id,
        );

        if (outerActiveTask.queued) {
          return undefined;
        }

        outerActiveTask.queued = true;

        try {
          await outerActiveTask.promise;
        } catch {
          // nothing to do
        }
      }
    }

    if (outerTeardownInitiated) {
      log.warn('teardown already initiated');

      return undefined;
    }

    const changedFiles = outerChangedFiles;

    outerChangedFiles = [];

    const taskId = generateShortId();

    const abortController = createAbortController(trigger);

    const taskPromise = runTask({
      abortController,
      changedFiles,
      firstEvent,
      taskId,
      trigger,
    }) // eslint-disable-next-line promise/prefer-await-to-then
      .then(() => {
        if (taskId === outerActiveTask?.id) {
          log.debug('%s (%s): completed task', trigger.name, taskId);

          outerActiveTask = null;
        }
      })
      // eslint-disable-next-line promise/prefer-await-to-then
      .catch(() => {
        log.warn('%s (%s): task failed', trigger.name, taskId);
      });

    log.debug('%s (%s): started task', trigger.name, taskId);

    // eslint-disable-next-line require-atomic-updates
    outerActiveTask = {
      abortController,
      id: taskId,
      promise: taskPromise,
      queued: false,
    };

    return taskPromise;
  };

  return {
    expression: trigger.expression,
    initialRun: trigger.initialRun,
    outerActiveTask,
    persistent: trigger.persistent,
    teardown: async () => {
      if (outerTeardownInitiated) {
        log.warn('teardown already initiated');

        return;
      }

      outerTeardownInitiated = true;

      if (trigger.onTeardown) {
        const taskId = generateShortId();

        try {
          await trigger.onTeardown({
            spawn: createSpawn(taskId, {
              throttleOutput: trigger.throttleOutput,
            }),
          });
        } catch (error) {
          log.error(
            {
              error,
            },
            'teardown produced an error',
          );
        }
      }
    },
    trigger: async (events: readonly FileChangeEvent[]) => {
      for (const event of events) {
        if (outerChangedFiles.includes(event.filename)) {
          continue;
        }

        outerChangedFiles.push(event.filename);
      }

      try {
        await handleSubscriptionEvent();
      } catch (error) {
        log.error(
          {
            error,
          },
          'trigger produced an error',
        );
      }
    },
  };
};
