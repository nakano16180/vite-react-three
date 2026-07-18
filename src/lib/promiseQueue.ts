export type PromiseQueue = <T>(operation: () => Promise<T>) => Promise<T>;

export const createPromiseQueue = (): PromiseQueue => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
};
