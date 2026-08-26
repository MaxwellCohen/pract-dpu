import { defineCapability, type CapabilityRunArgs } from "@pracht/capabilities";
import { readCounter } from "../lib/no-js";

interface Output {
  count: number;
}

export default defineCapability({
  title: "Counter increment",
  description: "Increment the demo counter cookie and return the new count.",
  input: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
    },
    required: ["count"],
  },
  effect: "write",
  expose: { http: true },
  middleware: ["counter-cookie"],
  async run({ request }: CapabilityRunArgs): Promise<Output> {
    return { count: readCounter(request) + 1 };
  },
});
