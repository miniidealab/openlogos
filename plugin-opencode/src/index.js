import { createHooks } from "./hooks.js";

/**
 * OpenCode plugin entry for OpenLogos.
 * Keeps logic minimal: command routing + session context injection.
 */
export const OpenLogosPlugin = async (ctx) => createHooks(ctx);

export default OpenLogosPlugin;
