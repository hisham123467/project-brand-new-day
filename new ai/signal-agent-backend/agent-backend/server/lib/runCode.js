// Lets the agent run short JavaScript snippets (e.g. to check a calculation
// or demonstrate logic) and see the output.
//
// IMPORTANT SECURITY NOTE: Node's built-in `vm` module restricts what code
// can easily reach (no `require`, no `process`, no filesystem/network by
// default) but it is NOT a hard security boundary — sufficiently
// determined code can sometimes escape `vm` sandboxes. This is fine for
// trusted/internal use or a single-operator demo. If you're exposing this
// to the public, run code in real isolation instead — a throwaway Docker
// container or microVM (Firecracker/gVisor) per execution, no network
// access, hard CPU/memory/time limits. This module is OFF by default;
// turn it on deliberately via ENABLE_CODE_EXECUTION=true in .env once
// you've understood that tradeoff.

const vm = require('vm');

const TIMEOUT_MS = 2000;
const MAX_OUTPUT_CHARS = 4000;

function runSandboxedJs(code) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(stringify).join(' ')),
    error: (...args) => logs.push('ERR: ' + args.map(stringify).join(' '))
  };

  const sandbox = {
    console: sandboxConsole,
    Math, JSON, Array, Object, String, Number, Boolean, Date, RegExp,
    // deliberately no require, process, fs, fetch, setTimeout, etc.
  };

  const context = vm.createContext(sandbox);

  let result;
  try {
    const script = new vm.Script(code);
    result = script.runInContext(context, { timeout: TIMEOUT_MS });
  } catch (err) {
    logs.push('ERR: ' + err.message);
  }

  let output = logs.join('\n');
  if (result !== undefined) {
    output += (output ? '\n' : '') + '=> ' + stringify(result);
  }
  if (!output) output = '(no output)';

  return output.slice(0, MAX_OUTPUT_CHARS);
}

function stringify(val) {
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

module.exports = { runSandboxedJs };
