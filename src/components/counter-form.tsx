import { Form } from "@pracht/core";
import { useState } from "preact/hooks";
import { COUNTER_COOKIE, readCookie } from "../lib/no-js";
import { getRequestFlags } from "../lib/request-flags";

function initialCount(): number {
  if (typeof document !== "undefined") {
    const raw = readCookie(document.cookie, COUNTER_COOKIE);
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return getRequestFlags().counter;
}

/**
 * Pracht capability form increments a cookie (works with JS off).
 * Client button is JS-only, for contrast.
 */
export function CounterForm() {
  const [serverCount, setServerCount] = useState(initialCount);
  const [clientCount, setClientCount] = useState(0);

  return (
    <div class="flex flex-col gap-2">
      <Form
        capability="counter.increment"
        class="flex flex-col gap-2"
        onCapabilityResult={(envelope) => {
          if (envelope.ok) setServerCount(envelope.data.count);
        }}
      >
        <button class="rounded-md bg-blue-500 p-2 text-white" type="submit">
          Server Button Clicked {serverCount} times
        </button>
      </Form>
      <button
        class="rounded-md bg-blue-500 p-2 text-white"
        type="button"
        onClick={() => setClientCount(clientCount + 1)}
      >
        Client Button Clicked {clientCount} times
      </button>
    </div>
  );
}
