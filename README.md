# Turbowatch 🏎

Extremely fast file change detector and task orchestrator for Node.js.

If you ever wanted something like [Nodemon](https://nodemon.io/) but more capable, then you are at the right place.

Basic usage:

```bash
npm install turbowatch
cat > turbowatch.ts <<'EOD'
import { defineConfig } from 'turbowatch';

export default defineConfig({
  project: __dirname,
  triggers: [
    {
      expression: ['match', '*.ts', 'basename'],
      name: 'build',
      onChange: async ({ spawn }) => {
        await spawn`tsc`;
      },
    },
  ],
});
EOD
npm exec turbowatch ./turbowatch.ts
```

> **Note** See [logging](#logging) instructions to print logs that explain what Turbowatch is doing.

Refer to recipes:

* [Rebuilding assets when file changes are detected](#rebuilding-assets-when-file-changes-are-detected)
* [Restarting server when file changes are detected](#restarting-server-when-file-changes-are-detected)
* [Retrying failing triggers](#retrying-failing-triggers)
* [Gracefully terminating Turbowatch](#gracefully-terminating-turbowatch)
* [Handling the `AbortSignal`](#handling-the-abortsignal)
* [Tearing down project](#tearing-down-project)
* [Throttling `spawn` output](#throttling-spawn-output)
* [Watching multiple scripts](#watching-multiple-scripts)
* [Using custom file watching backend](#using-custom-file-watching-backend)

||Turbowatch|Nodemon|
|---|---|---|
|[Node.js interface (scriptable)](#api)|✅|❌<sup>1</sup>|
|[Graceful termination (teardown)](#gracefully-terminating-turbowatch)|✅|❌<sup>2</sup>|
|[Scriptable child processes (zx)](#spawn)|✅|❌|
|Retries|✅|❌|
|Debounce|✅|❌|
|Interruptible workflows|✅|❌|
|Concurrent workflows|✅|❌|
|[Log grouping](#throttling-spawn-output)|✅|❌|
|[Bring-your-own backend](#using-custom-file-watching-backend)|✅|❌|
|Works with long-running processes|✅|✅|
|Works with build utilities and REPLs|✅|✅|
|Watch specific files or directories|✅|✅|
|Ignoring specific files or directories|✅|✅|
|Open source and available|✅|✅|

<sup><sup>1</sup> Undocumented</sup><br>
<sup><sup>2</sup> Nodemon only provides the ability to [send a custom signal](https://github.com/remy/nodemon#gracefully-reloading-down-your-script) to the worker.</sup><br>

## API

> **Note** `defineConfig` is used to export configuration for the consumption by `turbowatch` program. If you want to run Turbowatch programmatically, then use `watch`. The API of both methods is equivalent.

Turbowatch [defaults](#recipes) are a good choice for most projects. However, Turbowatch has _many_ options that you should be familiar with for advance use cases.

```ts
import {
  watch,
  type ChangeEvent,
} from 'turbowatch';

void watch({
  // Debounces triggers by 1 second.
  // Most multi-file spanning changes are non-atomic. Therefore, it is typically desirable to
  // batch together information about multiple file changes that happened in short succession.
  // Provide { debounce: { wait: 0 } } to disable debounce.
  debounce: {
    wait: 1000,
  },
  // The base directory under which all files are matched.
  // Note: This is different from the "root project" (https://github.com/gajus/turbowatch#project-root).
  project: __dirname,
  triggers: [
    {
      // Expression match files based on name.
      // https://github.com/gajus/turbowatch#expressions
      expression: [
        'allof',
        ['not', ['dirname', 'node_modules']],
        [
          'anyof',
          ['match', '*.ts', 'basename'],
          ['match', '*.tsx', 'basename'],
        ]
      ],
      // Indicates whether the onChange routine should be triggered on script startup.
      // Defaults to true. Set it to false if you would like onChange routine to not run until the first changes are detected.
      initialRun: true,
      // Determines what to do if a new file change is detected while the trigger is executing.
      // If {interruptible: true}, then AbortSignal will abort the current onChange routine.
      // If {interruptible: false}, then Turbowatch will wait until the onChange routine completes.
      // Defaults to true.
      interruptible: false,
      // Name of the trigger. Used for debugging
      // Must match /^[a-z0-9-_]+$/ pattern and must be unique.
      name: 'build',
      // Routine that is executed when file changes are detected.
      onChange: async ({ spawn }: ChangeEvent) => {
        await spawn`tsc`;
        await spawn`tsc-alias`;
      },
      // Routine that is executed when shutdown signal is received.
      onTeardown: async ({ spawn }) => {
        await spawn`rm -fr ./dist`;
      },
      // Label a task as persistent if it is a long-running process, such as a dev server or --watch mode.
      persistent: false,
      // Retry a task if it fails. Otherwise, watch program will throw an error if trigger fails.
      // Defaults to { retries: 3 }
      retry: {
        retries: 3,
      },
    },
  ],
});
```

## Motivation

To abstract the complexity of orchestrating file watching operations.

For context, we are using [Turborepo](https://turbo.build/). The reason this project came to be is because Turborepo does not have "watch" mode (issue [#986](https://github.com/vercel/turbo/issues/986)).

At first, we attempted to use a combination of `tsc --watch`, `concurrently` and Nodemon, but started to run into things breaking left and right, e.g.

* services restarting prematurely (before all the assets are built)
* services failing to gracefully shutdown and then failing to start, e.g. because ports are in use

Furthermore, the setup for each workspace was repetitive and not straightforward, and debugging issues was not a great experience because you have many workspaces running in watch mode producing tons of logs. Many of the workspaces being dependencies of each other, this kept re-triggering watch operations causing the mentioned issues.

In short, it quickly became clear that we need the ability to have more control over the orchestration of what/when needs to happen when files change.

We started with a script. At first I added _debounce_. That improved things. Then I added _graceful termination_ logic, which mostly made everything work. We still had occasional failures due to out-of-order events, but adding _retry_ logic fixed that too... At the end, while we got everything to work, it took a lot of effort and it still was a collection of hacky scripts that are hard to maintain and debug, and that's how Turbowatch came to be –

Turbowatch is a toolbox for orchestrating and debugging file watching operations based on everything we learned along the way.

> **Note** If you are working on a very simple project, i.e. just one build step or just one watch operation, then **you don't need Turbowatch**. Turbowatch is designed for monorepos or otherwise complex workspaces where you have dozens or hundreds of build steps that depend on each other (e.g. building and re-building dependencies, building/starting/stopping Docker containers, populating data, sending notifications, etc).

We also [shared these learnings](https://github.com/vercel/turbo/issues/986#issuecomment-1477360394) with Turborepo team in hopes that it will help to design an embedded file watching experience.

## Use Cases

Turbowatch can be used to automate any sort of operations that need to happen in response to files changing, e.g.,

* You can run (and conditionally restart) long-running processes (like your Node.js application)
* You can build assets (like TypeScript and Docker images)

## `spawn`

Turbowatch exposes `spawn` function that is an instance of [zx](https://github.com/google/zx). Use it to evaluate shell commands:

```ts
async ({ spawn }: ChangeEvent) => {
  await spawn`tsc`;
  await spawn`tsc-alias`;
},
```

The reason Turbowatch abstracts `zx` is to enable graceful termination of child-processes when triggers are configured to be `interruptible`.

## Persistent tasks

Your setup may include tasks that are not designed to exit, e.g. `next dev` (starts Next.js in development mode).

It is important that these tasks are marked as `persistent` to distinguish them from tasks that run to completion as that changes how Turbowatch treats them.

||Persistent|Non-Persistent|
|---|---|---|
|Ignore `FileChangeEvent` if `{ interruptible: false }`|✅|❌|

## Expressions

Expressions are used to match files. The most basic expression is `match` – it evaluates as true if a glob pattern matches the file, e.g.

Match all files with `*.ts` extension:

```ts
['match', '*.ts', 'basename']
```

Expressions can be combined using `allof` and `anyof`, e.g.,

Match all files with `*.ts` or `*.tsx` extensions:

```ts
[
  'anyof', 
  ['match', '*.ts', 'basename'],
  ['match', '*.tsx', 'basename']
]
```

Finally, `not` evaluates as true if the sub-expression evaluated as false, i.e. inverts the sub-expression.

Match all files with `*.ts` extension, but exclude `index.ts`:

```ts
[
  'allof', 
  ['match', '*.ts', 'basename'],
  [
    'not',
    ['match', 'index.ts', 'basename']
  ]
]
```

This is the gist behind Turbowatch expressions. However, there are many more expressions. Inspect `Expression` type for further guidance.

```ts
type Expression =
  // Evaluates as true if all of the grouped expressions also evaluated as true.
  | ['allof', ...Expression[]]
  // Evaluates as true if any of the grouped expressions also evaluated as true.
  | ['anyof', ...Expression[]]
  // Evaluates as true if a given file has a matching parent directory.
  | ['dirname' | 'idirname', string]
  // Evaluates as true if a glob matches against the basename of the file.
  | ['match' | 'imatch', string, 'basename' | 'wholename']
  // Evaluates as true if the sub-expression evaluated as false, i.e. inverts the sub-expression.
  | ['not', Expression];
```

> **Note** Turbowatch expressions are a subset of [Watchman expressions](https://facebook.github.io/watchman/docs/expr/allof.html). Originally, Turbowatch was developed to leverage Watchman as a superior backend for watching a large number of files. However, along the way, we discovered that Watchman does not support symbolic links (issue [#105](https://github.com/facebook/watchman/issues/105#issuecomment-1469496330)). Unfortunately, that makes Watchman unsuitable for projects that utilize linked dependencies (which is the direction in which the ecosystem is moving for dependency management in monorepos). As such, Watchman was replaced with chokidar. We are hoping to provide Watchman as a backend in the future. Therefore, we made Turbowatch expressions syntax compatible with a subset of Watchman expressions.

> **Note** Turbowatch uses [micromatch](https://github.com/micromatch/micromatch) for glob matching. Please note that you should be using forward slash (`/`) to separate paths, even on Windows.

## Recipes

### Rebuilding assets when file changes are detected

```ts
import { watch } from 'turbowatch';

void watch({
  project: __dirname,
  triggers: [
    {
      expression: [
        'allof',
        ['not', ['dirname', 'node_modules']],
        ['match', '*.ts', 'basename'],
      ],
      name: 'build',
      onChange: async ({ spawn }) => {
        await spawn`tsc`;
        await spawn`tsc-alias`;
      },
    },
  ],
});
```

### Restarting server when file changes are detected

```ts
import { watch } from 'turbowatch';

void watch({
  project: __dirname,
  triggers: [
    {
      expression: [
        'allof',
        ['not', ['dirname', 'node_modules']],
        [
          'anyof',
          ['match', '*.ts', 'basename'],
          ['match', '*.graphql', 'basename'],
        ]
      ],
      // Because of this setting, Turbowatch will kill the processes that spawn starts
      // when it detects changes when it detects a change.
      interruptible: true,
      name: 'start-server',
      onChange: async ({ spawn }) => {
        await spawn`tsx ./src/bin/wait.ts`;
        await spawn`tsx ./src/bin/server.ts`;
      },
    },
  ],
});
```

### Watching `node_modules`

There is more than one way to watch `node_modules`. However, through trial and error we found that the following set of rules work the best for a generalized solution.

```ts
import { watch } from 'turbowatch';

void watch({
  project: path.resolve(__dirname, '../..'),
  triggers: [
    {
      expression: [
        'anyof',
        [
          'allof',
          ['dirname', 'node_modules'],
          ['dirname', 'dist'],
          ['match', '*', 'basename'],
        ],
        [
          'allof',
          ['not', ['dirname', 'node_modules']],
          ['dirname', 'src'],
          ['match', '*', 'basename'],
        ],
      ],
      name: 'build',
      onChange: async ({ spawn }) => {
        return spawn`pnpm run build`;
      },
    },
  ],
});
```

This setup makes an assumption that your workspaces sources are in `src` directory and `build` task outputs to `dist` directory.

### Reusing expressions

This might be common sense, but since Turbowatch scripts are regular JavaScript scripts, you can (and should) abstract your expressions and routines.

How you do it is entirely up to you, e.g. You could abstract just expressions or you could go as far as abstracting the entire `trigger`:

```ts
import { watch } from 'turbowatch';
import {
  buildTrigger,
} from '@/turbowatch';

void watch({
  project: __dirname,
  triggers: [
    buildTrigger(),
  ],
});
```

Such abstraction helps to avoid errors that otherwise may occur due to duplicative code across workspaces.

### Reducing unnecessary reloads

Something that is important to consider when orchestrating file watching triggers is how to avoid unnecessary reloads. Consider if this was your "build" script:

```bash
rm -fr dist && tsc && tsc-alias
```

and let's assume that you are using an expression such as this one to detect when dependencies are updated:

```ts
[
  'allof',
  ['dirname', 'node_modules'],
  ['dirname', 'dist'],
  ['match', '*'],
],
```

Running this script will produce at least 3 file change events:

1. when `rm -fr dist` completes
1. when `tsc` completes
1. when `tsc-alias` completes

What's even worse is that even if the output has not changed, you are still going to trigger file change events (because `dist` get replaced).

To some degree, `debounce` setting helps with this. However, it will only help if there is no more than 1 second (by default) inbetween every command.

One way to avoid this entirely is by using an intermediate directory to output files and swapping only the files that changed. Here is how we do it:

```bash
rm -fr .dist && tsc --project tsconfig.build.json && rsync -cr --delete .dist/ ./dist/ && rm -fr .dist
```

This "build" script will always produce at most 1 event, and won't produce any events if the outputs have not changed.

This is not specific to Turbowatch, but something worth considering as you are designing your build pipeline.

### Retrying failing triggers

Retries are configured by passing a `retry` property to the trigger configuration.

```ts
/**
 * @property factor The exponential factor to use. Default is 2.
 * @property maxTimeout The maximum number of milliseconds between two retries. Default is 30,000.
 * @property minTimeout The number of milliseconds before starting the first retry. Default is 1000.
 * @property retries The maximum amount of times to retry the operation. Default is 3. Seting this to 1 means do it once, then retry it once.
 */
type Retry = {
  factor?: number,
  maxTimeout?: number,
  minTimeout?: number,
  retries?: number,
}
```

### Gracefully terminating Turbowatch

> **Note** `SIGINT` is automatically handled if you are using `turbowatch` executable to evaluate your Turbowatch script. This examples shows how to programmatically gracefully shutdown Turbowatch if you choose not to use `turbowatch` program to evaluate your watch scripts.

> **Warning** Unfortunately, many tools do not allow processes to gracefully terminate. There are open support issues for this in npm ([#4603](https://github.com/npm/npm/issues/4603)), pnpm ([#2653](https://github.com/pnpm/pnpm/issues/2653#issuecomment-1476686711)) and yarn ([#4667](https://github.com/yarnpkg/yarn/issues/4667)), but they haven't been addressed. Therefore, do not wrap your `turbowatch` script execution using these tools if you require processes to gracefully terminate.

`watch` returns an instance of `TurbowatchController`, which can be used to gracefully terminate the script:

```ts
const { shutdown } = await watch({
  project: __dirname,
  triggers: [
    {
      name: 'test',
      expression: ['match', '*', 'basename'],
      onChange: async ({ spawn }) => {
        // `sleep 60` will receive `SIGTERM` as soon as `shutdown()` is called.
        await spawn`sleep 60`;
      },
    }
  ],
});

// SIGINT is the signal sent when we press Ctrl+C
process.once('SIGINT', () => {
  void shutdown();
});
```

Invoking `shutdown` will propagate an abort signal to all `onChange` handlers. The processes that were initiated using [`spawn`](#spawn) will receive `SIGTERM` signal.

### Gracefully terminating Turbowatch using an `AbortController`

In addition to being to Turbowatch using the `shutdown` routine, Turbowatch instance can be shutdown using an `AbortController`. The main difference is that `shutdown` can be awaited to know when the shutdown routine has run to completion.

```ts
const abortController = new AbortController();

void watch({
  abortController,
  project: __dirname,
  triggers: [
    {
      name: 'test',
      expression: ['match', '*', 'basename'],
      onChange: async ({ spawn }) => {
        // `sleep 60` will receive `SIGTERM` as soon as `shutdown()` is called.
        await spawn`sleep 60`;
      },
    }
  ],
});

void abortController.abort();
```

### Handling the `AbortSignal`

Workflow might be interrupted in two scenarios:

* when Turbowatch is being gracefully shutdown
* when routine is marked as `interruptible` and a new file change is detected

Implementing interruptible workflows requires that you define `AbortSignal` handler. If you are using [`zx`](https://npmjs.com/zx), such abstraction could look like so:

> **Note** Turbowatch already comes with [`zx`](https://npmjs.com/zx) bound to the `AbortSignal`. Just use `spawn`. Documentation demonstrates how to implement equivalent functionality.

```ts
import { type ProcessPromise } from 'zx';

const interrupt = async (
  processPromise: ProcessPromise,
  abortSignal: AbortSignal,
) => {
  let aborted = false;

  const kill = () => {
    aborted = true;

    processPromise.kill();
  };

  abortSignal.addEventListener('abort', kill, { once: true });

  try {
    await processPromise;
  } catch (error) {
    if (!aborted) {
      console.log(error);
    }
  }

  abortSignal.removeEventListener('abort', kill);
};
```

which you can then use to kill your scripts, e.g.

```ts
export default watch({
  project: __dirname,
  triggers: [
    {
      expression: ['match', '*.ts', 'basename'],
      interruptible: false,
      name: 'sleep',
      onChange: async ({ abortSignal }) => {
        await interrupt($`sleep 30`, abortSignal);
      },
    },
  ],
});
```

### Tearing down project

`onTeardown` is going to be called when Turbowatch is gracefully terminated. Use it to "clean up" the project if necessary.

> **Warning** There is no timeout for `onTeardown`.

```ts
import { watch } from 'turbowatch';

export default watch({
  abortController,
  project: __dirname,
  triggers: [
    {
      expression: ['match', '*.ts', 'basename'],
      name: 'build',
      onChange: async ({ spawn }) => {
        await spawn`tsc`;
      },
      onTeardown: async () => {
        await spawn`rm -fr ./dist`;
      },
    },
  ],
});
```

### Throttling `spawn` output

When multiple processes are sending logs in parallel, the log stream might be hard to read, e.g.

```yaml
redis:dev: 973191cf > #5 sha256:7f65636102fd1f499092cb075baa95784488c0bbc3e0abff2a6d853109e4a948 4.19MB / 9.60MB 22.3s
api:dev: a1e4c6a7 > [18:48:37.171] 765ms debug @utilities #waitFor: Waiting for database to be ready...
redis:dev: 973191cf > #5 sha256:d01ec855d06e16385fb33f299d9cc6eb303ea04378d0eea3a75d74e26c6e6bb9 0B / 1.39MB 22.7s
api:dev: a1e4c6a7 > [18:48:37.225]  54ms debug @utilities #waitFor: Waiting for Redis to be ready...
worker:dev: 2fb02d72 > [18:48:37.313]  88ms debug @utilities #waitFor: Waiting for database to be ready...
redis:dev: 973191cf > #5 sha256:7f65636102fd1f499092cb075baa95784488c0bbc3e0abff2a6d853109e4a948 5.24MB / 9.60MB 22.9s
worker:dev: 2fb02d72 > [18:48:37.408]  95ms debug @utilities #waitFor: Waiting for Redis to be ready...
redis:dev: 973191cf > #5 sha256:7f65636102fd1f499092cb075baa95784488c0bbc3e0abff2a6d853109e4a948 6.29MB / 9.60MB 23.7s
api:dev: a1e4c6a7 > [18:48:38.172] 764ms debug @utilities #waitFor: Waiting for database to be ready...
api:dev: a1e4c6a7 > [18:48:38.227]  55ms debug @utilities #waitFor: Waiting for Redis to be ready...
```

In this example, `redis`, `api` and `worker` processes produce logs at almost the exact same time causing the log stream to switch between outputting from a different process every other line. This makes it hard to read the logs.

By default, Turbowatch throttles log output to at most once a second per task, producing a lot more easier to follow log output:

```yaml
redis:dev: 973191cf > #5 sha256:7f65636102fd1f499092cb075baa95784488c0bbc3e0abff2a6d853109e4a948 4.19MB / 9.60MB 22.3s
redis:dev: 973191cf > #5 sha256:d01ec855d06e16385fb33f299d9cc6eb303ea04378d0eea3a75d74e26c6e6bb9 0B / 1.39MB 22.7s
redis:dev: 973191cf > #5 sha256:7f65636102fd1f499092cb075baa95784488c0bbc3e0abff2a6d853109e4a948 5.24MB / 9.60MB 22.9s
redis:dev: 973191cf > #5 sha256:7f65636102fd1f499092cb075baa95784488c0bbc3e0abff2a6d853109e4a948 6.29MB / 9.60MB 23.7s
api:dev: a1e4c6a7 > [18:48:37.171] 765ms debug @utilities #waitFor: Waiting for database to be ready...
api:dev: a1e4c6a7 > [18:48:37.225]  54ms debug @utilities #waitFor: Waiting for Redis to be ready...
api:dev: a1e4c6a7 > [18:48:38.172] 764ms debug @utilities #waitFor: Waiting for database to be ready...
api:dev: a1e4c6a7 > [18:48:38.227]  55ms debug @utilities #waitFor: Waiting for Redis to be ready...
worker:dev: 2fb02d72 > [18:48:37.313]  88ms debug @utilities #waitFor: Waiting for database to be ready...
worker:dev: 2fb02d72 > [18:48:37.408]  95ms debug @utilities #waitFor: Waiting for Redis to be ready...
```

However, this means that some logs might come out of order. To disable this feature, set `{ throttleOutput: { delay: 0 } }`.

### Watching multiple scripts

By default, `turbowatch` will look for `turbowatch.ts` script in the current working directory. However, you can pass multiple scripts to `turbowatch` to run them concurrently:

```bash
turbowatch ./foo.ts ./bar.ts
```

You can also provide a glob pattern:

```bash
turbowatch '**/turbowatch.ts'
```

### Using custom file watching backend

Many of the existing file watching solutions come with tradeoffs, e.g. Watchman does not track symbolic links ([#105](https://github.com/facebook/watchman/issues/105#issuecomment-1469496330)), chokidar is failing to register file changes ([#1240](https://github.com/paulmillr/chokidar/issues/1240)), `fs.watch` behavior is platform specific, etc. For this reason, Turbowatch provides several backends to choose from and allows to bring-your-own backend by implementing `FileWatchingBackend` interface.

By default, Turbowatch uses `fs.watch` on MacOS (Node.js v19.1+) and fallsback to [chokidar](https://github.com/paulmillr/chokidar) on other platforms.

```ts
import {
  watch,
  // Smart Watcher that detects the best available file-watching backend.
  TurboWatcher,
  // fs.watch based file watcher.
  FSWatcher,
  // Chokidar based file watcher.
  ChokidarWatcher,
  // Interface that all file watchers must implement.
  FileWatchingBackend,
} from 'turbowatch';

export default watch({
  Watcher: TurboWatcher,
  project: __dirname,
  triggers: [],
});
```

### Logging

Turbowatch uses [Roarr](https://github.com/gajus/roarr) logger.

Export `ROARR_LOG=true` environment variable to enable log printing to `stdout`.

Use [@roarr/cli](https://github.com/gajus/roarr-cli) to pretty-print logs.

```bash
ROARR_LOG=true turbowatch | roarr
```

## Experiments

These are features that are available behind feature flags (`TURBOWATCH_EXPERIMENTAL_*`).

They are released to gather community feedback and may change at any point in future.

> **Note** There are no active experiments at the moment.

## Alternatives

The biggest benefit of using Turbowatch is that it provides a single abstraction for all file watching operations. That is, you might get away with Nodemon, concurrently, `--watch`, etc. running in parallel, but using Turbowatch will introduce consistency to how you perform watch operations.

### Why not use `X --watch`?

Many tools provide built-in watch functionality, e.g. `tsc --watch`. However, there are couple of problems with relying on them:

* Running many file watchers is inefficient and is probably draining your laptop's battery faster than you realize. Turbowatch uses a single server to watch all file changes.
* Native tools do not allow to combine operations, e.g. If your build depends on `tsc --watch` and `tsc-alias --watch`, then you cannot combine them. On the other hand, Turbowatch allows you to chain arbitrary operations.

> **Note** Turbowatch is not a replacement for services that implement Hot Module Replacement (HMR), e.g. Next.js. However, you should still wrap those operations in Turbowatch for consistency, e.g.
> ```ts
> void watch({
>   project: __dirname,
>   triggers: [
>     {
>       expression: ['dirname', __dirname],
>       // Marking this routine as non-interruptible will ensure that
>       // next dev is not restarted when file changes are detected.
>       interruptible: false,
>       name: 'start-server',
>       onChange: async ({ spawn }) => {
>         await spawn`next dev`;
>       },
>       // Enabling this option modifies what Turbowatch logs and warns
>       // you if your configuration is incompatible with persistent tasks.
>       persistent: true,
>     },
>   ],
> });
> ```

### Why not concurrently?

I have [seen](https://github.com/justkey007/tsc-alias#add-it-to-your-build-scripts-in-packagejson) [concurrently](https://github.com/open-cli-tools/concurrently) used to "chain" watch operations such as:

```bash
concurrently "tsc -w" "tsc-alias -w"
```

While this might work by brute-force, it will produce unexpected results as the order of execution is not guaranteed.

If you are using Turbowatch, simply execute one command after the other in the trigger workflow, e.g.

```ts
async ({ spawn }: ChangeEvent) => {
  await spawn`tsc`;
  await spawn`tsc-alias`;
},
```

### Why not Turborepo?

[Turborepo](https://turbo.build/) currently does not have support for watch mode (issue [#986](https://github.com/vercel/turbo/issues/986)). However, Turbowatch has been designed to work with Turborepo.

To use Turbowatch with Turborepo:

1. define a persistent task
1. run the persistent task using `--parallel`

Example:

```json
"dev": {
  "cache": false,
  "persistent": true
},
```

```bash
turbo run dev --parallel
```

> **Note** We found that using `dependsOn` with Turbowatch produces undesirable effects. Instead, simply use Turbowatch expressions to identify when dependencies update.

> **Note** Turbowatch is not aware of the Turborepo dependency graph. Meaning, that your builds might fail at the first attempt. However, if you setup Turbowatch to [watch `node_modules`](#watching-node_modules), then Turbowatch will automatically retry failing builds as soon as the dependencies are built.
