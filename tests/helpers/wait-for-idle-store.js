/**
 * Test helper that can be used to wait until the forking store is an "idle" state
 * @param {*} forkingStore The forking store instance
 * @param {number} maxWaitTime The maximum amount of time that should be waited. If the store isn't idle by that time an error will be thrown.
 *
 * @returns Promise<void> Returns a promise that resolves when the forking store is idle and rejects when the wait time is passed without it becoming idle.
 */
export function waitForIdleStore(forkingStore, maxWaitTime = 100) {
  return new Promise((resolve, reject) => {
    const startTime = new Date();
    const id = setInterval(() => {
      if (forkingStore._isIdle) {
        clearInterval(id);
        resolve();
      } else {
        const currentTime = new Date();
        if (currentTime - startTime > maxWaitTime) {
          clearInterval(id);
          reject(
            `The forking store didn't return to an idle state within the expected time of ${maxWaitTime}ms`,
          );
        }
      }
    }, 1);
  });
}
