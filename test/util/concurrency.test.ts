import assert from "node:assert/strict";
import { test } from "node:test";

import { mapWithLimit } from "../../src/util/concurrency.ts";

/** Resolves when `release` is called, so a test can hold tasks open. */
function gate() {
  let release = (): void => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
}

test("no more than the limit runs at once", async () => {
  const held = gate();
  let running = 0;
  let peak = 0;

  const work = mapWithLimit([1, 2, 3, 4, 5], 2, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await held.opened;
    running -= 1;
    return item * 2;
  });

  await Promise.resolve();
  assert.equal(peak, 2, "the third task waits for a slot");
  held.release();
  assert.deepEqual(await work, [2, 4, 6, 8, 10]);
});

test("results keep the order of the input, not of completion", async () => {
  const order: number[] = [];
  const results = await mapWithLimit([30, 10, 20], 3, async (delay, index) => {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delay));
    order.push(index);
    return index;
  });

  assert.deepEqual(results, [0, 1, 2]);
  assert.deepEqual(order, [1, 2, 0], "they really did finish out of order");
});

test("a limit below one still runs the work, one at a time", async () => {
  assert.deepEqual(
    await mapWithLimit(["a", "b"], 0, (item) => Promise.resolve(item.toUpperCase())),
    ["A", "B"],
  );
});

test("nothing to do needs no workers", async () => {
  assert.deepEqual(await mapWithLimit([], 4, () => Promise.reject(new Error("never called"))), []);
});
