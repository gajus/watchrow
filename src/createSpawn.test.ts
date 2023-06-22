import { createSpawn } from './createSpawn';
import { expect, it } from 'vitest';

it('returns outputs', async () => {
  const spawn = createSpawn('foo');

  const result = await spawn`echo 'Hello, World!'`;

  expect(String(result?.stdout)).toEqual('Hello, World!\n');
});

it('injects path to node_modules/.bin', async () => {
  const spawn = createSpawn('foo');

  const result = await spawn`echo $PATH`;

  expect(String(result?.stdout)).toMatch(/node_modules\/\.bin/u);
});

it('rejects if process produces an error', async () => {
  const spawn = createSpawn('foo');

  await expect(spawn`does-not-exist`).rejects.toThrowError(
    'Program exited with code 127.',
  );
});

const TIMEOUT = 100;

// TODO investigate why this test fails on CI
it.skip(
  'terminates spawned process when it receives abort signal',
  async () => {
    const abortController = new AbortController();

    const spawn = createSpawn('foo', { abortSignal: abortController.signal });

    setTimeout(() => {
      void abortController.abort();
    }, 50);

    await expect(spawn`sleep 10`).rejects.toThrowError();
  },
  TIMEOUT,
);

it(
  'waits for termination',
  async () => {
    const abortController = new AbortController();

    const spawn = createSpawn('foo', { abortSignal: abortController.signal });

    setTimeout(() => {
      void abortController.abort();
    }, 50);

    const start = Date.now();

    await expect(
      spawn`( trap '' TERM; exec sleep 0.1 )`,
    ).rejects.toThrowError();

    expect(Date.now() - start).toBeGreaterThan(100);
  },
  TIMEOUT * 2,
);
