import { open, send, close, SEND_TYPES } from "../lib/dispatch.js";
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
      send(d.id, { type: flags.type, message: flags.message, data: flags.data });
    } else if (CLOSE_SUCCESS_TYPES.includes(flags.type)) {
      await close(d.id, { message: flags.message });
    } else if (CLOSE_ERROR_TYPES.includes(flags.type)) {
      await close(d.id, { error: flags.message });
    } else {
      console.error(`Unknown type: ${flags.type}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\u2717 ${err.message}`);
    process.exit(1);
  }
})();
