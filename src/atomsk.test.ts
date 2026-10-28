// Ported from the Rust unit tests. Run with `npm test`; the network test needs ATOMSK_NETWORK_TEST=1.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildArguments, executableName, resolveAtomsk, verifyAtomsk, writeStructure } from './command';
import { downloadAndInstall, findFile, pickArchiveUrl, resolveArchiveUrl } from './install';
import { handleRequest } from './mcp';

const temporaryDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atomsk-gui-test-'));

test('create structure with orientation and option', () => {
  const source: Source = { kind: 'create', lattice: 'fcc', parameters: ['4.02', 'Al'], orientation: ['[100]', '[010]', '[001]'] };
  assert.deepEqual(
    buildArguments(source, [{ flag: '-duplicate', arguments: ['2', '2', '2'] }], ['out.cfg']),
    ['--create', 'fcc', '4.02', 'Al', 'orient', '[100]', '[010]', '[001]', '-duplicate', '2', '2', '2', 'out.cfg', '-ow'],
  );
});

test('create without orientation drops empty optional parameters', () => {
  const source: Source = { kind: 'create', lattice: 'fcc', parameters: ['4.05', 'Al', ''], orientation: [] };
  assert.deepEqual(
    buildArguments(source, [{ flag: '-duplicate', arguments: ['2', '2', '2'] }], ['al.xsf']),
    ['--create', 'fcc', '4.05', 'Al', '-duplicate', '2', '2', '2', 'al.xsf', '-ow'],
  );
});

test('opened file omits empty optional arguments; no options converts', () => {
  const source: Source = { kind: 'file', path: 'in.xsf' };
  assert.deepEqual(
    buildArguments(source, [{ flag: '-cut', arguments: ['above', '5', 'z', ''] }], ['out.lmp']),
    ['in.xsf', '-cut', 'above', '5', 'z', 'out.lmp', '-ow'],
  );
  assert.deepEqual(buildArguments({ kind: 'file', path: 'a.cfg' }, [], ['b.xyz']), ['a.cfg', 'b.xyz', '-ow']);
});

test('atomsk lookup order', () => {
  const root = temporaryDirectory();
  const [managed, onPath] = [path.join(root, 'managed'), path.join(root, 'path')];
  for (const directory of [managed, onPath]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, executableName()), '');
  }
  const found = (overridePath?: string, saved?: string) => resolveAtomsk(overridePath, saved, undefined, managed, [onPath]);
  assert.equal(found('forced'), 'forced');
  assert.equal(found(undefined, path.join(onPath, executableName())), path.join(onPath, executableName()));
  assert.equal(found(undefined, path.join(root, 'missing')), path.join(managed, executableName()));
  fs.rmSync(path.join(managed, executableName()));
  assert.equal(found(), path.join(onPath, executableName()));
  fs.rmSync(root, { recursive: true });
});

test('writes in the output directory and over its own input', { skip: process.platform === 'win32' }, async () => {
  const root = temporaryDirectory();
  // Fake atomsk: writes its working directory into the output (the argument before -ow).
  const program = path.join(root, 'atomsk');
  fs.writeFileSync(program, '#!/bin/sh\nfor argument; do output=$previous; previous=$argument; done\npwd > "$output"\n', { mode: 0o755 });
  const input = path.join(root, 'POSCAR');
  fs.writeFileSync(input, 'old');

  let result = await writeStructure(program, { kind: 'file', path: input }, [], path.join(root, 'out.cfg'));
  assert.ok(result.success, result.log);
  assert.equal(fs.readFileSync(path.join(root, 'out.cfg'), 'utf8').trim(), fs.realpathSync(root));

  result = await writeStructure(program, { kind: 'file', path: input }, [], input);
  assert.ok(result.success, result.log);
  assert.match(result.log, /\.atomsk-gui-\w+\/POSCAR -ow/);
  assert.notEqual(fs.readFileSync(input, 'utf8').trim(), 'old');
  assert.deepEqual(fs.readdirSync(root).sort(), ['POSCAR', 'atomsk', 'out.cfg']);

  // Relative input resolves against the caller, not the output directory atomsk runs in.
  result = await writeStructure(program, { kind: 'file', path: path.relative(process.cwd(), input) }, [], path.join(root, 'x.cfg'));
  assert.ok(result.log.includes(` ${input} `), result.log);

  result = await writeStructure(program, { kind: 'file', path: input }, [], path.join(root, 'missing', 'x.cfg'));
  assert.equal(result.success, false);
  assert.match(result.log, /output folder .* does not exist/);

  fs.chmodSync(root, 0o555);
  try {
    result = await writeStructure(program, { kind: 'file', path: input }, [], input);
    assert.equal(result.success, false);
    assert.match(result.log, /Cannot create a temporary folder/);
  } finally {
    fs.chmodSync(root, 0o755);
  }
  fs.rmSync(root, { recursive: true });
});

test('mode arguments include the merge file count and automatic wrap', () => {
  const merge: Source = { kind: 'mode', mode: 'merge', values: { direction: 'z', files: ['a.cfg', 'b.xsf'] } };
  assert.deepEqual(
    buildArguments(merge, [], ['out.cfg']),
    ['--merge', 'z', '2', 'a.cfg', 'b.xsf', 'out.cfg', '-ow'],
  );
  const rdf: Source = { kind: 'mode', mode: 'rdf', values: { file: 'a.cfg', rmax: '10', dr: '0.1' } };
  assert.deepEqual(buildArguments(rdf, [], []), ['--rdf', 'a.cfg', '10', '0.1', '-wrap', '-ow']);
  const localSymmetry: Source = { kind: 'mode', mode: 'local-symmetry', values: { file: 'a.cfg' } };
  assert.deepEqual(
    buildArguments(localSymmetry, [{ flag: '-wrap', arguments: [] }], ['sym.cfg']),
    ['--local-symmetry', 'a.cfg', '-wrap', 'sym.cfg', '-ow'],
  );
});

test('modes write a file, a prefix, a folder and a list file', { skip: process.platform === 'win32' }, async () => {
  const root = temporaryDirectory();
  const program = path.join(root, 'atomsk');
  fs.writeFileSync(program, '#!/bin/sh\nprintf "%s\\n" "$@" > args.txt\ncp "$2" list-copy.txt 2>/dev/null || true\n', { mode: 0o755 });
  const first = path.join(root, 'a.cfg');
  const second = path.join(root, 'b.cfg');
  const dump = path.join(root, 'dump.lmc');
  for (const file of [first, second, dump]) fs.writeFileSync(file, '');
  const readArguments = (directory: string) => fs.readFileSync(path.join(directory, 'args.txt'), 'utf8').trimEnd().split('\n');

  let result = await writeStructure(program, { kind: 'mode', mode: 'average', values: { files: [first, second] } }, [], path.join(root, 'average.cfg'));
  assert.ok(result.success, result.log);
  let args = readArguments(root);
  assert.equal(args[0], '--average');
  assert.match(args[1], /atomsk-gui-list-.*[/\\]files\.lst$/);
  assert.deepEqual(args.slice(2), ['average.cfg', '-ow']);
  assert.deepEqual(fs.readFileSync(path.join(root, 'list-copy.txt'), 'utf8').trimEnd().split('\n'), ['a.cfg', 'b.cfg']);

  result = await writeStructure(program, { kind: 'mode', mode: 'unfold', values: { file: dump } }, [], path.join(root, 'snap.cfg'));
  assert.ok(result.success, result.log);
  args = readArguments(root);
  assert.deepEqual(args, ['--unfold', dump, 'snap.cfg', '-ow']);

  const folder = path.join(root, 'output');
  fs.mkdirSync(folder);
  result = await writeStructure(program, { kind: 'mode', mode: 'difference', values: { file1: first, file2: second } }, [], folder);
  assert.ok(result.success, result.log);
  args = readArguments(folder);
  assert.deepEqual(args, ['--diff', first, second, '-ow']);

  result = await writeStructure(program, { kind: 'mode', mode: 'unfold', values: { file: dump } }, [], path.join(root, 'no-extension'));
  assert.equal(result.success, false);
  assert.match(result.log, /extension Atomsk can write/);
  fs.rmSync(root, { recursive: true });
});

test('picks archive from download page', () => {
  const page = `<li><a href="./code/atomsk_b0.13.1
.tar.gz" title="src"></a></li>
<li><a href="./code/atomsk_b0.13.1
_Linux-amd64.tar.gz" title="x"></a></li>
<li><a href="./code/atomsk_b0.13.1
_Windows.zip" title="y"></a></li>`;
  assert.equal(pickArchiveUrl(page, '_Linux-amd64.tar.gz'), 'https://atomsk.univ-lille.fr/code/atomsk_b0.13.1_Linux-amd64.tar.gz');
  assert.equal(pickArchiveUrl(page, '_MacOS.tar.gz'), undefined);
});

test('finds binary, not man page', () => {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, 'pkg', 'man'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg', 'man', 'atomsk'), '');
  fs.writeFileSync(path.join(root, 'pkg', 'atomsk'), '');
  assert.equal(findFile(root, 'atomsk'), path.join(root, 'pkg', 'atomsk'));
  fs.rmSync(root, { recursive: true });
});

test('downloads and runs real atomsk', { skip: !process.env.ATOMSK_NETWORK_TEST }, async () => {
  const root = temporaryDirectory();
  const installed = await downloadAndInstall(await resolveArchiveUrl(), path.join(root, 'work'), path.join(root, 'bin'));
  await verifyAtomsk(installed);
  fs.rmSync(root, { recursive: true });
});

const request = (method: string, params?: unknown) => handleRequest({ jsonrpc: '2.0', id: 1, method, params });

test('mcp initialize echoes a supported version', async () => {
  assert.equal((await request('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion, '2025-03-26');
  const reply = await request('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(reply.result.protocolVersion, '2025-06-18');
  assert.equal(reply.result.serverInfo.name, 'atomsk-gui');
});

test('mcp lists its tools, ignores notifications, rejects unknown methods', async () => {
  const names = (await request('tools/list')).result.tools.map((tool: { name: string }) => tool.name);
  assert.deepEqual(names, ['list_lattices', 'list_options', 'list_formats', 'list_modes', 'create_structure', 'transform_file', 'run_mode']);
  assert.equal(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal((await request('nope')).error.code, -32601);
});

test('mcp lists and validates modes before running', async () => {
  const modes = JSON.parse((await request('tools/call', { name: 'list_modes', arguments: {} })).result.content[0].text);
  assert.ok(modes.some((mode: { id: string }) => mode.id === 'merge'));
  assert.ok(modes.some((mode: { id: string }) => mode.id === 'rdf'));

  const call = async (args: unknown) => (await request('tools/call', { name: 'run_mode', arguments: args })).result;
  let result = await call({ mode: 'nope' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown mode/);
  result = await call({ mode: 'merge', args: { files: ['a.cfg'] }, output: '/tmp/x.cfg' });
  assert.match(result.content[0].text, /at least 2/);
  result = await call({ mode: 'merge', args: { files: ['a.cfg', 'b.cfg'], nope: 'x' }, output: '/tmp/x.cfg' });
  assert.match(result.content[0].text, /no parameter "nope"/);
  result = await call({ mode: 'merge', args: { files: ['a.cfg', 'b.cfg'] } });
  assert.match(result.content[0].text, /"output" is required/);
  result = await call({ mode: 'difference', args: { file1: 'a.cfg', file2: 'b.cfg' }, output: '/definitely/missing' });
  assert.match(result.content[0].text, /must be an existing folder/);

  const root = temporaryDirectory();
  fs.writeFileSync(path.join(root, 'chain_img0.cfg'), '');
  result = await call({ mode: 'interpolate', args: { file1: 'a.cfg', file2: 'b.cfg', images: '2' }, output: path.join(root, 'chain.cfg') });
  assert.match(result.content[0].text, /already exists/);
  fs.rmSync(root, { recursive: true });
});

test('mcp create_structure validates before running', async () => {
  const call = async (args: unknown) => (await request('tools/call', { name: 'create_structure', arguments: args })).result;
  let result = await call({ lattice: 'fc', params: ['4'], output: '/tmp/x.cfg' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /fcc/);
  result = await call({ lattice: 'fcc', params: ['4.05'], output: '/tmp/x.cfg' });
  assert.match(result.content[0].text, /parameter/);
  result = await call({ lattice: 'fcc', params: ['4.05', 'Al'], options: [{ flag: '-nope' }], output: '/tmp/x.cfg' });
  assert.match(result.content[0].text, /Unknown option/);
});
