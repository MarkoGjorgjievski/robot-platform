/** At most `max` jobs at once; the rest wait in order. A throwing job frees its slot. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => { if (active < max) queue.shift()?.(); };
  return function limit<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        job().then(resolve, reject).finally(() => { active--; next(); });
      });
      next();
    });
  };
}
