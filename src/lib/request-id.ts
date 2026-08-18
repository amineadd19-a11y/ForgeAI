import { randomBytes } from "crypto";

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
}
