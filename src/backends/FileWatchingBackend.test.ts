import { isFSWatcherAvailable } from '../isFSWatcherAvailable';
import { ChokidarWatcher } from './ChokidarWatcher';
import { type FileWatchingBackend } from './FileWatchingBackend';
import { FSWatcher } from './FSWatcher';
import { TurboWatcher } from './TurboWatcher';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import * as sinon from 'sinon';
import { beforeEach, expect, it } from 'vitest';

const fixturesPath = path.resolve(__dirname, '.fixtures');

beforeEach(async () => {
  await fs.rm(fixturesPath, {
    force: true,
    recursive: true,
  });

  await fs.mkdir(fixturesPath);
});

const waitForReady = (watcher: FileWatchingBackend) => {
  return new Promise((resolve) => {
    watcher.on('ready', () => {
      resolve(null);
    });
  });
};

const backends = [
  {
    name: 'Chokidar',
    Watcher: ChokidarWatcher,
  },
  {
    name: 'FS',
    Watcher: FSWatcher,
  },
  {
    name: 'Turbo',
    Watcher: TurboWatcher,
  },
];

for (const { Watcher, name } of backends) {
  if (isFSWatcherAvailable() === false && Watcher === FSWatcher) {
    continue;
  }

  it('[' + name + '] detects file change', async () => {
    const watcher = new Watcher(fixturesPath);

    await waitForReady(watcher);

    const onChange = sinon.stub();

    watcher.on('change', onChange);

    await setTimeout(100);

    await fs.writeFile(path.join(fixturesPath, 'foo'), '');

    await setTimeout(100);

    expect(
      onChange.calledWith(
        sinon.match({
          filename: path.join(fixturesPath, 'foo'),
        }),
      ),
    ).toBe(true);

    await watcher.close();
  });

  it('[' + name + '] detects changes to a file that is replaced', async () => {
    const watcher = new Watcher(fixturesPath);

    await waitForReady(watcher);

    const onChange = sinon.stub();

    watcher.on('change', onChange);

    await setTimeout(100);

    await fs.writeFile(path.join(fixturesPath, 'foo'), '');

    await setTimeout(100);

    await fs.unlink(path.join(fixturesPath, 'foo'));

    await setTimeout(100);

    await fs.writeFile(path.join(fixturesPath, 'foo'), '');

    await setTimeout(100);

    expect(onChange.callCount).toBeGreaterThanOrEqual(3);

    await watcher.close();
  });

  // TODO investigate why this is failing in GitHub CI
  it.skip('[' + name + '] detects hard link change (linked file)', async () => {
    await fs.mkdir(path.resolve(fixturesPath, 'foo'));

    await fs.writeFile(path.join(fixturesPath, 'bar'), '');

    await fs.link(
      path.join(fixturesPath, 'bar'),
      path.join(fixturesPath, 'foo', 'bar'),
    );

    const watcher = new Watcher(path.resolve(fixturesPath, 'foo'));

    await waitForReady(watcher);

    const onChange = sinon.stub();

    watcher.on('change', onChange);

    await setTimeout(100);

    await fs.writeFile(path.join(fixturesPath, 'bar'), '');

    await setTimeout(100);

    expect(
      onChange.calledWith(
        sinon.match({
          filename: path.join(fixturesPath, 'foo', 'bar'),
        }),
      ),
    ).toBe(true);

    await watcher.close();
  });

  it('[' + name + '] detects symlink change (linked file)', async () => {
    await fs.mkdir(path.resolve(fixturesPath, 'foo'));

    await fs.writeFile(path.join(fixturesPath, 'bar'), '');

    await fs.symlink(
      path.join(fixturesPath, 'bar'),
      path.join(fixturesPath, 'foo', 'bar'),
    );

    const watcher = new Watcher(path.resolve(fixturesPath, 'foo'));

    await waitForReady(watcher);

    const onChange = sinon.stub();

    watcher.on('change', onChange);

    await setTimeout(100);

    await fs.writeFile(path.join(fixturesPath, 'bar'), '');

    await setTimeout(100);

    expect(
      onChange.calledWith(
        sinon.match({
          filename: path.join(fixturesPath, 'foo', 'bar'),
        }),
      ),
    ).toBe(true);

    await watcher.close();
  });

  it('[' + name + '] detects symlink change (linked path)', async () => {
    await fs.mkdir(path.resolve(fixturesPath, 'foo'));
    await fs.mkdir(path.resolve(fixturesPath, 'bar'));
    await fs.writeFile(path.join(fixturesPath, 'bar', 'baz'), '');

    await fs.symlink(
      path.join(fixturesPath, 'bar'),
      path.join(fixturesPath, 'foo', 'bar'),
    );

    const watcher = new Watcher(path.resolve(fixturesPath, 'foo'));

    await waitForReady(watcher);

    const onChange = sinon.stub();

    watcher.on('change', onChange);

    await setTimeout(100);

    await fs.writeFile(path.join(fixturesPath, 'bar', 'baz'), '');

    await setTimeout(100);

    expect(
      onChange.calledWith(
        sinon.match({
          filename: path.join(fixturesPath, 'foo', 'bar', 'baz'),
        }),
      ),
    ).toBe(true);

    // TODO investigate why this is failing in GitHub CI
    // expect(
    //   onChange.calledWith({
    //     filename: path.join(fixturesPath, 'foo', 'bar'),
    //   }),
    // ).toBe(true);

    await watcher.close();
  });
}
