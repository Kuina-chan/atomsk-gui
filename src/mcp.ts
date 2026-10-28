// Model Context Protocol server over stdio (`atomsk-gui --mcp`). No Electron dependency.
//
// Newline-delimited JSON-RPC 2.0 on stdin/stdout; diagnostics go to stderr only.
// Started by main.ts as a separate plain-Node process (`node dist/mcp.js` works too).

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { catalog } from './catalog';
import { errorMessage, isFile, locateAtomsk, writeStructure } from './command';

// ponytail: untyped JSON-RPC values, every field is checked where it is read.
type Json = any;

const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const VERSION: string = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

/** Serves requests until stdin closes. */
export async function run(): Promise<void> {
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let request: Json;
    try {
      request = JSON.parse(line);
    } catch (error) {
      console.error(`atomsk-gui mcp: malformed JSON: ${errorMessage(error)}`);
      process.stdout.write(JSON.stringify(errorResponse(null, -32700, 'Parse error')) + '\n');
      continue;
    }
    const response = await handleRequest(request);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}

function errorResponse(id: Json, code: number, message: string): Json {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** undefined for notifications (no `id`), which never get a reply. */
export async function handleRequest(request: Json): Promise<Json | undefined> {
  if (request?.id === undefined) return undefined;
  const { id } = request;
  const params = request.params ?? {};
  let result: Json;
  switch (request.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      result = {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'atomsk-gui', version: VERSION },
      };
      break;
    }
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = { tools: TOOL_DEFINITIONS };
      break;
    case 'tools/call':
      try {
        result = toolResult(await callTool(params.name ?? '', params.arguments ?? {}), false);
      } catch (error) {
        result = toolResult(errorMessage(error), true);
      }
      break;
    default:
      return errorResponse(id, -32601, 'Method not found');
  }
  return { jsonrpc: '2.0', id, result };
}

function toolResult(text: string, isError: boolean): Json {
  return { content: [{ type: 'text', text }], isError };
}

const OPTIONS_SCHEMA = {
  type: 'array',
  description: 'Atomsk options applied in order. Use list_options to find flags and their arguments.',
  items: {
    type: 'object',
    properties: {
      flag: { type: 'string', description: 'Option flag, e.g. "-duplicate".' },
      args: { type: 'array', items: { type: 'string' }, description: 'Option arguments in catalog order; omit optional ones you do not need.' },
    },
    required: ['flag'],
  },
};

const OVERWRITE_SCHEMA = { type: 'boolean', description: 'Replace the output file if it already exists. Default false: the call fails instead.' };

const TOOL_DEFINITIONS = [
  {
    name: 'list_lattices',
    description: 'List the crystal lattices atomsk can create (id, label, description, params). Pass the id and the params, in the listed order, to create_structure.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_options',
    description: 'List the atomsk options (flag, label, description, args) that modify a structure, e.g. -duplicate, -cut, -rotate. There are about 80; use query to narrow them down.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Case-insensitive substring matched against flag, label and description.' },
    } },
  },
  {
    name: 'list_formats',
    description: 'List the file formats atomsk can read and write, with their file extensions. The output extension selects the format written.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_structure',
    description: 'Create an atomic structure from a crystal lattice with atomsk, optionally apply options, and write it to a file. The output extension selects the file format.',
    inputSchema: { type: 'object', properties: {
      lattice: { type: 'string', description: 'Lattice id from list_lattices, e.g. "fcc".' },
      params: { type: 'array', items: { type: 'string' }, description: 'Lattice parameters in the order listed by list_lattices, e.g. ["4.05", "Al"] for fcc.' },
      orient: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: 'Optional crystal orientation: three directions along x, y, z, e.g. ["[100]", "[010]", "[001]"].' },
      options: OPTIONS_SCHEMA,
      output: { type: 'string', description: 'Path of the file to write, e.g. "/tmp/al.cfg".' },
      overwrite: OVERWRITE_SCHEMA,
    }, required: ['lattice', 'params', 'output'] },
  },
  {
    name: 'transform_file',
    description: 'Read an existing structure file with atomsk, optionally apply options, and write the result to another file. With no options and a different output extension this converts the file format.',
    inputSchema: { type: 'object', properties: {
      input: { type: 'string', description: 'Path of the existing structure file.' },
      options: OPTIONS_SCHEMA,
      output: { type: 'string', description: 'Path of the file to write.' },
      overwrite: OVERWRITE_SCHEMA,
    }, required: ['input', 'output'] },
  },
];

/** Resolves to the tool's text; throws with the error text. */
async function callTool(name: string, args: Json): Promise<string> {
  switch (name) {
    case 'list_lattices':
      return JSON.stringify(catalog.lattices);
    case 'list_formats':
      return JSON.stringify(catalog.formats);
    case 'list_options': {
      const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
      const matches = catalog.options.filter((option) =>
        [option.flag, option.label, option.description].some((text) => text.toLowerCase().includes(query)));
      return JSON.stringify(matches);
    }
    case 'create_structure': {
      const latticeId = requiredString(args, 'lattice');
      const lattice = catalog.lattices.find((lattice) => lattice.id === latticeId);
      if (!lattice) {
        throw new Error(`Unknown lattice "${latticeId}". ${suggestions(latticeId, catalog.lattices.map((lattice) => lattice.id))}`);
      }
      const parameters = stringList(args, 'params');
      if (!fits(lattice.params, parameters.length)) {
        throw new Error(
          `Lattice "${lattice.id}" takes ${lattice.params.length} parameter(s) ` +
          `(${lattice.params.filter((param) => !param.optional).length} required) but ${parameters.length} were given. ` +
          `Expected: ${lattice.params.map((param) => param.label).join(', ')}.`);
      }
      const orientation = stringList(args, 'orient');
      if (orientation.length !== 0 && orientation.length !== 3) {
        throw new Error('orient needs exactly 3 directions, e.g. ["[100]", "[010]", "[001]"].');
      }
      const options = parseOptions(args);
      const output = checkedOutput(args);
      return execute({ kind: 'create', lattice: lattice.id, parameters, orientation }, options, output);
    }
    case 'transform_file': {
      const input = requiredString(args, 'input');
      if (!isFile(input)) throw new Error(`Input file "${input}" does not exist.`);
      const options = parseOptions(args);
      const output = checkedOutput(args);
      return execute({ kind: 'file', path: input }, options, output);
    }
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

async function execute(source: Source, options: OptionInvocation[], output: string): Promise<string> {
  const program = locateAtomsk();
  if (!program) {
    throw new Error('atomsk was not found. Install it and put it on PATH, set the ATOMSK_PATH environment variable to its binary, or start the atomsk-gui window once so it can download it.');
  }
  const { success, log } = await writeStructure(program, source, options, output);
  if (!success) throw new Error(`status: failed\n${log}`);
  return `status: success\n${log}`;
}

function requiredString(args: Json, key: string): string {
  const value = args?.[key];
  if (typeof value !== 'string' || value === '') throw new Error(`"${key}" is required and must be a non-empty string.`);
  return value;
}

/** Missing means empty; strings and numbers are accepted, anything else is an error. */
function stringList(args: Json, key: string): string[] {
  const value = args?.[key];
  if (value === undefined || value === null) return [];
  const valid = Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number');
  if (!valid) throw new Error(`"${key}" must be an array of strings.`);
  return value.map(String);
}

/** Whether `count` values satisfy the required and optional slots of `params`. */
function fits(params: Param[], count: number): boolean {
  return params.filter((param) => !param.optional).length <= count && count <= params.length;
}

function suggestions(wanted: string, candidates: string[]): string {
  const lowered = wanted.toLowerCase();
  const close = candidates
    .filter((candidate) => {
      const other = candidate.toLowerCase();
      return other.includes(lowered) || lowered.includes(other);
    })
    .slice(0, 8);
  return close.length === 0
    ? 'No close match; call list_lattices or list_options to see what exists.'
    : `Close matches: ${close.join(', ')}.`;
}

function parseOptions(args: Json): OptionInvocation[] {
  if (args.options === undefined) return [];
  if (!Array.isArray(args.options)) throw new Error('"options" must be an array of {flag, args}.');
  return args.options.map((item: Json) => {
    if (typeof item?.flag !== 'string' || item.flag === '') throw new Error('Every option needs a "flag" string.');
    const flag: string = item.flag;
    const optionArguments = stringList(item, 'args');
    const entries = catalog.options.filter((entry) => entry.flag === flag);
    if (entries.length === 0) {
      throw new Error(`Unknown option "${flag}". ${suggestions(flag, catalog.options.map((entry) => entry.flag))}`);
    }
    if (!entries.some((entry) => fits(entry.args, optionArguments.length))) {
      const expected = entries.map((entry) => entry.args.map((arg) => arg.label).join(', '));
      throw new Error(`Option ${flag} does not accept ${optionArguments.length} argument(s). Expected: ${expected.join(' | ')}.`);
    }
    return { flag, arguments: optionArguments };
  });
}

/** Refuses to clobber an existing file unless `overwrite` is true. */
function checkedOutput(args: Json): string {
  const output = requiredString(args, 'output');
  if (fs.existsSync(output) && args.overwrite !== true) {
    throw new Error(`Output "${output}" already exists. Choose another path or pass overwrite: true.`);
  }
  return output;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
