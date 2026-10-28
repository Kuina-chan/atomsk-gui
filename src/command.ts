// Builds and runs the atomsk command line. No Electron dependency.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { catalog } from './catalog';

export function modeById(id: string): Mode | undefined {
  return catalog.modes.find((mode) => mode.id === id);
}

/** What a source writes: modes decide, create and normal always write one file. */
export function outputKind(source: Source): ModeOutput {
  return source.kind === 'mode' ? modeById(source.mode)?.output ?? 'file' : 'file';
}

/** The atomsk format keyword for a file extension, e.g. out.cfg -> cfg. */
export function formatForFile(file: string): string | undefined {
  const extension = path.extname(file).replace(/^\./, '').toLowerCase();
  if (extension === '') return undefined;
  const format = catalog.formats.find((format) => format.write && format.extensions.some((candidate) => candidate.toLowerCase() === extension));
  return format ? format.keyword ?? format.id : undefined;
}

/** Positional arguments of a mode, including its flag and any automatic option. */
function modeArguments(source: Extract<Source, { kind: 'mode' }>, options: OptionInvocation[]): string[] {
  const mode = modeById(source.mode);
  if (!mode) throw new Error(`Unknown mode "${source.mode}".`);
  const args: string[] = [];
  if (mode.flag !== '') args.push(mode.flag);
  for (const param of mode.args) {
    const value = source.values[param.name];
    if (value === undefined) continue;
    if (param.kind === 'files' || param.kind === 'list') {
      const files = (Array.isArray(value) ? value : [value]).filter((file) => file !== '');
      if (files.length === 0) continue;
      // merge takes the number of files before the list.
      if (mode.countFiles) args.push(String(files.length));
      args.push(...files);
    } else if (Array.isArray(value)) {
      args.push(...value.filter((item) => item !== ''));
    } else if (value !== '') {
      args.push(value);
    }
  }
  return args;
}

/** Options a mode always needs, unless the user added them; e.g. -wrap avoids a question on stdin. */
function automaticOptions(source: Source, options: OptionInvocation[]): string[] {
  if (source.kind !== 'mode') return [];
  return (modeById(source.mode)?.autoOptions ?? []).filter((flag) => !options.some((option) => option.flag === flag));
}

/** Empty arguments (unfilled optional fields) are left out. `output` is empty for modes that name their own files. */
// ponytail: an empty optional argument followed by a filled one shifts positions; atomsk options rarely mix them.
export function buildArguments(source: Source, options: OptionInvocation[], output: string[]): string[] {
  const filled = (values: string[]) => values.filter((value) => value !== '');
  const args: string[] = [];
  if (source.kind === 'create') {
    args.push('--create', source.lattice, ...filled(source.parameters));
    if (source.orientation.length > 0) args.push('orient', ...source.orientation);
  } else if (source.kind === 'file') {
    args.push(source.path);
  } else {
    args.push(...modeArguments(source, options));
  }
  for (const option of options) args.push(option.flag, ...filled(option.arguments));
  if (output.length > 0) args.push(...output);
  // Automatic options go after the output, which is where the documentation places options for these modes.
  args.push(...automaticOptions(source, options));
  // Overwrite without asking, atomsk would otherwise wait for an answer on stdin.
  args.push('-ow');
  return args;
}

export function executableName(): string {
  return process.platform === 'win32' ? 'atomsk.exe' : 'atomsk';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stat(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

export function isFile(file: string): boolean {
  return stat(file)?.isFile() ?? false;
}

function isDirectory(directory: string): boolean {
  return stat(directory)?.isDirectory() ?? false;
}

// Same directories the GTK build used (GLib's user config/data dirs), so a saved atomsk path and theme carry over.
function userDirectory(kind: 'config' | 'data'): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'atomsk-gui');
  const base = kind === 'config'
    ? process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'atomsk-gui');
}

function configPath(name: string): string {
  return path.join(userDirectory('config'), name);
}

function readConfig(name: string): string | undefined {
  try {
    return fs.readFileSync(configPath(name), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function writeConfig(name: string, text: string): void {
  fs.mkdirSync(path.dirname(configPath(name)), { recursive: true });
  fs.writeFileSync(configPath(name), text);
}

export type Theme = 'system' | 'light' | 'dark';

/** "system" when missing or invalid. */
export function loadTheme(): Theme {
  const theme = readConfig('theme');
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

export function saveTheme(theme: Theme): void {
  writeConfig('theme', theme);
}

/** Where the GUI installs the atomsk it downloads. */
export function managedDirectory(): string {
  return path.join(userDirectory('data'), 'bin');
}

export function saveAtomskPath(file: string): void {
  writeConfig('atomsk-path', file);
}

/** First hit of: explicit override, saved path, next to the GUI, managed directory, `PATH`. */
export function resolveAtomsk(
  overridePath: string | undefined,
  savedPath: string | undefined,
  siblingDirectory: string | undefined,
  managed: string,
  pathDirectories: string[],
): string | undefined {
  if (overridePath) return overridePath;
  if (savedPath && isFile(savedPath)) return savedPath;
  const directories = [...(siblingDirectory ? [siblingDirectory] : []), managed, ...pathDirectories];
  return directories.map((directory) => path.join(directory, executableName())).find(isFile);
}

/** undefined when no atomsk can be found. */
export function locateAtomsk(): string | undefined {
  return resolveAtomsk(
    process.env.ATOMSK_PATH || undefined,
    readConfig('atomsk-path'),
    path.dirname(process.execPath),
    managedDirectory(),
    (process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  );
}

/** Runs `program` with stdin closed; rejects only when it cannot be started at all. */
export function capture(program: string, args: string[], cwd?: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(program, args, { cwd, windowsHide: true, maxBuffer: 1024 ** 3 }, (error, stdout, stderr) => {
      // A string code (ENOENT, EACCES…) means the process never ran; a number is its exit status.
      if (error && typeof error.code === 'string') reject(error);
      else resolve({ success: !error, output: stdout + stderr });
    });
    child.stdin?.end();
  });
}

/** Checks that `program` is a working atomsk by running `--version`. */
export async function verifyAtomsk(program: string): Promise<void> {
  let result;
  try {
    result = await capture(program, ['--version']);
  } catch (error) {
    throw new Error(`Cannot run ${program}: ${errorMessage(error)}`);
  }
  if (!result.success && !result.output.toLowerCase().includes('atomsk')) {
    throw new Error(`${program} does not look like atomsk:\n${result.output.trim()}`);
  }
}

/** Whether two paths name the same file; Windows paths are case-insensitive. */
export function samePath(first: string, second: string): boolean {
  const normalize = (file: string) => (process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file));
  return normalize(first) === normalize(second);
}

/** Resolves the file arguments of a mode against the caller's directory, since atomsk runs elsewhere. */
function resolveModeSource(source: Extract<Source, { kind: 'mode' }>): Extract<Source, { kind: 'mode' }> {
  const mode = modeById(source.mode);
  if (!mode) return source;
  const values: Record<string, string | string[]> = { ...source.values };
  for (const param of mode.args) {
    const value = values[param.name];
    if (value === undefined) continue;
    if (param.kind === 'file') {
      const file = Array.isArray(value) ? value[0] : value;
      if (file && file !== '' && file.toUpperCase() !== 'NULL') values[param.name] = path.resolve(file);
    } else if (param.kind === 'files') {
      values[param.name] = (Array.isArray(value) ? value : [value]).filter((file) => file !== '').map((file) => path.resolve(file));
    }
  }
  return { kind: 'mode', mode: source.mode, values };
}

/** Atomsk 0.13 names unfold outputs <outputfile><n><ext>; rename them to the prefix the user chose. */
function renameNumberedOutputs(destination: string, directory: string): number {
  const extension = path.extname(destination);
  const base = path.basename(destination);
  const prefix = base.slice(0, base.length - extension.length);
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)${extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  let renamed = 0;
  for (const name of fs.readdirSync(directory)) {
    const match = pattern.exec(name);
    if (!match) continue;
    const target = path.join(directory, `${prefix}${match[1]}${extension}`);
    fs.rmSync(target, { force: true });
    fs.renameSync(path.join(directory, name), target);
    renamed++;
  }
  return renamed;
}

/** Runs atomsk `program` for `source` and returns its combined log.
 *  Atomsk runs in the output's directory, because some formats (VASP POSCAR) are always written to a fixed
 *  name in the working directory. It cannot write over its own input, so that case writes into a temporary
 *  directory next to the destination, keeping the file name (atomsk picks some formats by exact name), then renames.
 *  Modes decide whether `destination` is a file, a prefix, a folder or unused. */
export async function writeStructure(
  program: string,
  source: Source,
  options: OptionInvocation[],
  destination: string,
): Promise<{ success: boolean; log: string }> {
  destination = path.resolve(destination);
  const kind = outputKind(source);
  let directory: string;
  let output: string[] = [];
  if (kind === 'file') {
    directory = path.dirname(destination);
    if (!isDirectory(directory)) return { success: false, log: `The output folder ${directory} does not exist.\n` };
    // Atomsk runs in this directory, so a relative name avoids modes (merge) that reject paths in output names.
    output = [path.basename(destination)];
  } else if (kind === 'prefix') {
    directory = path.dirname(destination);
    if (!isDirectory(directory)) return { success: false, log: `The output folder ${directory} does not exist.\n` };
    const extension = path.extname(destination);
    const format = formatForFile(destination);
    if (extension === '' || !format) {
      return { success: false, log: `Choose an output file name with an extension Atomsk can write, e.g. chain.cfg.\n` };
    }
    const base = path.basename(destination);
    output = [base.slice(0, base.length - extension.length), format];
  } else if (kind === 'numbered') {
    directory = path.dirname(destination);
    if (!isDirectory(directory)) return { success: false, log: `The output folder ${directory} does not exist.\n` };
    if (path.extname(destination) === '' || !formatForFile(destination)) {
      return { success: false, log: `Choose an output file name with an extension Atomsk can write, e.g. snapshots.xsf.\n` };
    }
    output = [path.basename(destination)];
  } else if (kind === 'folder') {
    directory = destination;
    if (!isDirectory(directory)) return { success: false, log: `The output folder ${directory} does not exist.\n` };
  } else {
    directory = process.cwd();
  }

  // Resolved against the caller's directory, since atomsk runs elsewhere.
  // ponytail: file names inside option arguments (-properties…) stay as typed; the catalog does not mark
  // which option arguments are files. Use absolute paths there.
  if (source.kind === 'file') source = { kind: 'file', path: path.resolve(source.path) };
  if (source.kind === 'mode') source = resolveModeSource(source);

  let temporaryDirectory: string | undefined;
  let listDirectory: string | undefined;
  try {
    if (kind === 'file' && source.kind === 'file' && samePath(source.path, destination)) {
      temporaryDirectory = fs.mkdtempSync(path.join(directory, '.atomsk-gui-'));
      output = [path.join(path.basename(temporaryDirectory), path.basename(destination))];
    }
  } catch (error) {
    return { success: false, log: `Cannot create a temporary folder in ${directory}: ${errorMessage(error)}\n` };
  }
  try {
    if (source.kind === 'mode') {
      const mode = modeById(source.mode);
      if (!mode) return { success: false, log: `Unknown mode "${source.mode}".\n` };
      // Modes that take a list file get one written from the paths the user selected.
      for (const param of mode.args.filter((param) => param.kind === 'list')) {
        const value = source.values[param.name];
        if (value === undefined) continue;
        const files = (Array.isArray(value) ? value : [value]).filter((file) => file !== '');
        if (files.length === 0) continue;
        listDirectory ??= fs.mkdtempSync(path.join(os.tmpdir(), 'atomsk-gui-list-'));
        const listFile = path.join(listDirectory, `${param.name}.lst`);
        // Paths are read relative to atomsk's working directory; gather rejects absolute names in a list.
        const listed = files.map((file) => {
          const absolute = path.resolve(file);
          const relative = path.relative(directory, absolute);
          return relative === '' ? path.basename(absolute) : relative;
        });
        fs.writeFileSync(listFile, `${listed.join('\n')}\n`);
        source.values[param.name] = listFile;
      }
    }
  } catch (error) {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    if (listDirectory) fs.rmSync(listDirectory, { recursive: true, force: true });
    return { success: false, log: `Cannot prepare the atomsk command: ${errorMessage(error)}\n` };
  }

  let args: string[];
  try {
    args = buildArguments(source, options, output);
  } catch (error) {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    if (listDirectory) fs.rmSync(listDirectory, { recursive: true, force: true });
    return { success: false, log: `Cannot prepare the atomsk command: ${errorMessage(error)}\n` };
  }
  let log = `$ ${program} ${args.join(' ')}\n`;
  try {
    try {
      const result = await capture(program, args, directory);
      log += result.output;
      if (!result.success) return { success: false, log };
    } catch (error) {
      return { success: false, log: `${log}Cannot run ${program}: ${errorMessage(error)}\n` };
    }
    if (temporaryDirectory && output[0]) fs.renameSync(path.join(directory, output[0]), destination);
    if (kind === 'numbered') {
      const renamed = renameNumberedOutputs(destination, directory);
      if (renamed === 0) log += `No numbered snapshot files were found for ${path.basename(destination)}.\n`;
    }
    return { success: true, log };
  } catch (error) {
    return { success: false, log: `${log}Cannot replace ${destination}: ${errorMessage(error)}\n` };
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    if (listDirectory) fs.rmSync(listDirectory, { recursive: true, force: true });
  }
}
