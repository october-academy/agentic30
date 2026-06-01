export async function runWithSoftTimeout({
  operation,
  timeoutMs,
  abortController,
  onTimeout,
  onLateError,
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("runWithSoftTimeout requires an operation function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("runWithSoftTimeout requires a non-negative timeoutMs");
  }

  let timedOut = false;
  let timeout = null;

  const operationPromise = Promise.resolve()
    .then(operation)
    .catch((error) => {
      if (timedOut) {
        if (typeof onLateError === "function") {
          onLateError(error);
        }
        return null;
      }
      throw error;
    })
    .finally(() => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    });

  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      if (typeof onTimeout === "function") {
        onTimeout();
      }
      abortController?.abort?.();
      resolve(null);
    }, timeoutMs);
  });

  return Promise.race([operationPromise, timeoutPromise]);
}
