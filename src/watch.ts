import { TurboWatcher } from './backends/TurboWatcher';
import { createFileChangeQueue } from './createFileChangeQueue';
import { generateShortId } from './generateShortId';
import { Logger } from './Logger';
import { subscribe } from './subscribe';
import {
  type JsonObject,
  type Subscription,
  type TurbowatchConfiguration,
  type TurbowatchConfigurationInput,
  type TurbowatchController,
} from './types';
import { serializeError } from 'serialize-error';

const log = Logger.child({
  namespace: 'watch',
});

export const watch = (
  configurationInput: TurbowatchConfigurationInput,
): Promise<TurbowatchController> => {
  const {
    abortController,
    cwd,
    project,
    triggers,
    debounce: userDebounce,
    Watcher,
  }: TurbowatchConfiguration = {
    abortController: new AbortController(),
    // as far as I can tell, this is a bug in unicorn/no-unused-properties
    // https://github.com/sindresorhus/eslint-plugin-unicorn/issues/2051
    // eslint-disable-next-line unicorn/no-unused-properties
    debounce: {
      wait: 1_000,
    },

    // eslint-disable-next-line unicorn/no-unused-properties
    Watcher: TurboWatcher,
    ...configurationInput,
  };

  const abortSignal = abortController.signal;

  const subscriptions: Subscription[] = [];

  const watcher = new Watcher(project);

  let terminating = false;

  const shutdown = async () => {
    if (terminating) {
      return;
    }

    terminating = true;

    await watcher.close();

    abortController.abort();

    for (const subscription of subscriptions) {
      const { activeTask } = subscription;

      if (activeTask?.promise) {
        await activeTask?.promise;
      }
    }

    for (const subscription of subscriptions) {
      const { teardown } = subscription;

      if (teardown) {
        await teardown();
      }
    }
  };

  if (abortSignal) {
    abortSignal.addEventListener(
      'abort',
      () => {
        shutdown();
      },
      {
        once: true,
      },
    );
  }

  for (const trigger of triggers) {
    const initialRun = trigger.initialRun ?? true;
    const persistent = trigger.persistent ?? false;

    if (persistent && !initialRun) {
      throw new Error('Persistent triggers must have initialRun set to true.');
    }

    subscriptions.push(
      subscribe({
        abortSignal,
        cwd,
        expression: trigger.expression,
        hexColor: trigger.hexColor,
        id: generateShortId(),
        initialRun,
        interruptible: trigger.interruptible ?? true,
        name: trigger.name,
        onChange: trigger.onChange,
        onTeardown: trigger.onTeardown,
        persistent,
        retry: {
          retries: 3,
          ...trigger.retry,
        },
        throttleOutput: trigger.throttleOutput ?? { delay: 1_000 },
      }),
    );
  }

  let ready = false;

  const fileChangeQueue = createFileChangeQueue({
    abortSignal,
    project,
    subscriptions,
    userDebounce,
  });

  watcher.on('change', (event) => {
    if (!ready) {
      log.warn('ignoring change event before ready');

      return;
    }

    fileChangeQueue.trigger(event);
  });

  return new Promise((resolve, reject) => {
    watcher.on('error', (error) => {
      log.error(
        {
          error: serializeError(error) as unknown as JsonObject,
        },
        'could not watch project',
      );

      if (ready) {
        shutdown();
      } else {
        reject(error);
      }
    });

    watcher.on('ready', () => {
      ready = true;

      if (!terminating) {
        log.info('triggering initial runs');

        for (const subscription of subscriptions) {
          if (subscription.initialRun) {
            void subscription.trigger([]);
          }
        }

        log.info('ready for file changes');
      }

      resolve({
        shutdown,
      });
    });
  });
};
