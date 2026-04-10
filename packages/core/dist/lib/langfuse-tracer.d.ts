import { SessionManager } from '../server/session-manager.js';
import '../core/providers/types.js';

/**
 * langfuse-tracer.ts — Optional Langfuse tracing for SNA sessions.
 *
 * Structure:
 *   Langfuse Session = SNA session (groups all turns)
 *   Langfuse Trace   = 1 turn (user_message → complete)
 *     input  = user message
 *     output = assistant response
 *     children: thinking (generation), tool spans, etc.
 *
 * Design principles:
 * - Lazy dynamic import — no-op if langfuse not installed
 * - When active, ALL sessions are traced (tracer active = debug mode ON)
 * - Fire-and-forget: errors logged, never thrown
 * - Logs go through onLog callback → Loom structured logs
 */

/** Set the current user info for Langfuse traces. */
declare function setTracerUser(userId?: string, userEmail?: string): void;
declare function initTracer(config: {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
}, sessionManager: SessionManager, 
/** @deprecated onLog is ignored — langfuse logs now route through SDK logger */
_onLog?: (msg: string) => void): Promise<void>;
declare function shutdownTracer(): Promise<void>;

export { initTracer, setTracerUser, shutdownTracer };
