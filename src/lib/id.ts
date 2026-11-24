import { randomBytes } from "node:crypto";

/** Short, sortable-enough unique id (timestamp prefix + random). */
export function createId(): string {
  return Date.now().toString(36) + randomBytes(8).toString("hex");
}
