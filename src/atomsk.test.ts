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
    buildArguments(source, [{ flag: '-duplicate', arguments: ['2', '2', '2'] }], 'out.cfg'),
    ['--create', 'fcc', '4.02', 'Al', 'orient', '[100]', '[010]', '[001]', '-duplicate', '2', '2', '2', 'out.cfg', '-ow'],
  );
});

test('create without orientation drops empty optional parameters', () => {
  const source: Source = { kind: 'create', lattice: 'fcc', parameters: ['4.05', 'Al', ''], orientation: [] };
  assert.deepEqual(
    buildArguments(source, [{ flag: '-duplicate', arguments: ['2', '2', '2'] }], 'al.xsf'),
    ['--create', 'fcc', '4.05', 'Al', '-duplicate', '2', '2', '2', 'al.xsf', '-ow'],
  );
});

test('opened file omits empty optional arguments; no options converts', () => {
  const source: Source = { kind: 'file', path: 'in.xsf' };
  assert.deepEqual(
    buildArguments(source, [{ flag: '-cut', arguments: ['above', '5', 'z', ''] }], 'out.lmp'),
    ['in.xsf', '-cut', 'above', '5', 'z', 'out.lmp', '-ow'],
  );
  assert.deepEqual(buildArguments({ kind: 'file', path: 'a.cfg' }, [], 'b.xyz'), ['a.cfg', 'b.xyz', '-ow']);
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

test('mcp lists five tools, ignores notifications, rejects unknown methods', async () => {
  const names = (await request('tools/list')).result.tools.map((tool: { name: string }) => tool.name);
  assert.deepEqual(names, ['list_lattices', 'list_options', 'list_formats', 'create_structure', 'transform_file']);
  assert.equal(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal((await request('nope')).error.code, -32601);
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
