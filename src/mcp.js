import { readIndex, indexText, ToolRefusal } from './wiki.js';

// Envelope + format dispatch over wiki.js. Each tool has a `run` returning the
// complete data and a `text` view of it:
//   format "json" -> {structured}  (validated by the host against outputSchema)
//   format "text" -> {text, meta}  (raw-text channel)
// Refusals are {error, code, details?} in both formats.
//
// `caller` is accepted and ignored: read_index is not session-scoped.
const TOOLS = { read_index: { run: readIndex, text: indexText } };

const ECHO_MAX = 100;
const echo = (v) => (typeof v === 'string'
  ? JSON.stringify(v.length > ECHO_MAX ? `${v.slice(0, ECHO_MAX)}…` : v)
  : (v === null ? 'null' : typeof v));
const ok = (body) => ({ status: 200, body });

// A malformed envelope (missing `tool`) -> 400. Everything else -> 200; non-200
// is reserved for transport failures.
export async function handle(body) {
  const { tool, arguments: args, format: rawFormat } = body ?? {};
  if (typeof tool !== 'string' || tool.length === 0) {
    return { status: 400, body: { error: 'tool is required and must be a non-empty string', code: 'BAD_REQUEST' } };
  }
  // A host that predates typed tools sends no format: answer it as text.
  const format = rawFormat === undefined ? 'text' : rawFormat;
  if (format !== 'text' && format !== 'json') {
    return ok({ error: `format must be "text" or "json", got ${echo(rawFormat)}`, code: 'FORMAT_UNKNOWN' });
  }
  if (!Object.hasOwn(TOOLS, tool)) return ok({ error: `unknown tool: ${echo(tool)}`, code: 'TOOL_UNKNOWN' });
  if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
    return ok({ error: 'arguments must be an object', code: 'BAD_REQUEST' });
  }
  const t = TOOLS[tool];
  try {
    const data = await t.run(args ?? {});
    return ok(format === 'json' ? { structured: data } : t.text(data));
  } catch (e) {
    if (e instanceof ToolRefusal) {
      return ok({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
    }
    try { console.error(`code-wiki: tool ${tool} failed:`, e); } catch { /* logging must not fail the reply */ }
    return ok({ error: `${tool} failed unexpectedly: ${e?.message ?? String(e)}`, code: 'INTERNAL' });
  }
}
