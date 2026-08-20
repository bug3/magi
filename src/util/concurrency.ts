/**
 * Running a bounded number of tasks at once.
 *
 * The council fan-out is the caller this exists for: at most N seat calls are
 * in flight together, and the limit is honoured rather than assumed, so this is
 * the one place that decides what "two at a time" means. Results come back in
 * input order whatever order the tasks finished in, so what a stage records
 * never depends on a race.
 */

export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.min(Math.max(1, Math.floor(limit)), items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
