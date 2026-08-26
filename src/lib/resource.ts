/**
 * Wrap a promise so a component can suspend by calling `.read()`.
 * Same shape as React's temporary `use()` resource pattern.
 */
export function createResource<T>(promise: Promise<T>): { read(): T } {
  let status: "pending" | "success" | "error" = "pending";
  let result: T;
  let error: unknown;
  const suspender = promise.then(
    (value) => {
      status = "success";
      result = value;
    },
    (reason) => {
      status = "error";
      error = reason;
    },
  );

  return {
    read() {
      if (status === "pending") throw suspender;
      if (status === "error") throw error;
      return result!;
    },
  };
}
