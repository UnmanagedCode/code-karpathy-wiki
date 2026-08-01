import { readIndex } from './wiki.js';

// Thin dispatch over wiki.js. Domain refusals are {ok:false, code, reason}
// objects returned as the {result} payload — a normal MCP outcome the conductor
// relays to the model to reason about. They are NOT {error}: the host bridge
// (code-conductor/src/plugins/mcpBridge.js) throws whenever body.error is set,
// which would surface a refusal as a failed tool call.
//
// `caller` is accepted and ignored: read_index is not session-scoped.
const handlers = {
  read_index: (args) => readIndex(args),
};

// A handler may opt into the host's raw-text channel by returning {meta, text}:
// the host (code-conductor/src/plugins/mcpBridge.js) emits `meta` as one
// compact-JSON block and each entry of `text` as its own raw, UNESCAPED block —
// far cheaper and more legible than escaping the bodies into a JSON string.
// `meta` is required so a refusal {ok:false,code,reason} (no `text`) or any other
// structured return still rides in {result}.
function isRawTextResult(r) {
  if (!r || typeof r !== 'object') return false;
  if (!('meta' in r) || !('text' in r)) return false;
  const { text } = r;
  if (typeof text === 'string') return true;
  if (Array.isArray(text)) return text.every((s) => typeof s === 'string');
  return false;
}

// Envelope-level problems (missing/invalid `tool`) -> 400. Everything else ->
// 200 with {text, meta} (raw-text channel), {result} (domain refusal/structured),
// or {error}. Non-200 is reserved for transport failures.
export async function handle(body) {
  const { tool, arguments: args } = body ?? {};
  if (typeof tool !== 'string' || tool.length === 0) {
    return { status: 400, body: { error: 'tool is required and must be a non-empty string' } };
  }
  const fn = handlers[tool];
  if (!fn) return { status: 200, body: { error: `unknown tool: ${tool}` } };
  if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
    return { status: 200, body: { error: 'arguments must be an object' } };
  }
  try {
    const result = await fn(args ?? {});
    if (isRawTextResult(result)) {
      return { status: 200, body: { text: result.text, meta: result.meta } };
    }
    return { status: 200, body: { result: result === undefined ? null : result } };
  } catch (e) {
    return { status: 200, body: { error: e.message } };
  }
}
