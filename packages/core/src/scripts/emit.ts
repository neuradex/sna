/**
 * emit.ts — DEPRECATED: Use `sna dispatch` instead.
 *
 * Thin wrapper that forwards to dispatch for backward compatibility.
 * Existing skills that call:
 *   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type <type> --message "<text>"
 * will continue to work, but should migrate to:
 *   sna dispatch open --skill <name>
 *   sna dispatch <id> <type> --message "<text>"
 *   sna dispatch <id> close
 */

import { open, send, close, SEND_TYPES, type DispatchEventType } from "../lib/dispatch.js";
import { parseFlags } from "../lib/parse-flags.js";

const [, , ...args] = process.argv;
const flags = parseFlags(args);

const CLOSE_SUCCESS_TYPES = ["complete", "success"];
const CLOSE_ERROR_TYPES = ["error", "failed"];

if (!flags.skill || !flags.type || !flags.message) {
  console.error("DEPRECATED: Use 'sna dispatch' instead.");
  console.error("Usage: node emit.js --skill <name> --type <type> --message <text>");
  process.exit(1);
}

(async () => {
  try {
    const d = open({ skill: flags.skill });

    if (SEND_TYPES.includes(flags.type)) {
      send(d.id, { type: flags.type as DispatchEventType, message: flags.message, data: flags.data });
    } else if (CLOSE_SUCCESS_TYPES.includes(flags.type)) {
      await close(d.id, { message: flags.message });
    } else if (CLOSE_ERROR_TYPES.includes(flags.type)) {
      await close(d.id, { error: flags.message });
    } else {
      console.error(`Unknown type: ${flags.type}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
})();
