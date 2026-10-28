// Builds and runs the atomsk command line. No Electron dependency.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Empty arguments (unfilled optional fields) are left out. */
// ponytail: an empty optional argument followed by a filled one shifts positions; atomsk options rarely mix them.
export function buildArguments(source: Source, options: OptionInvocation[], output: string): string[] {
  const filled = (values: string[]) => values.filter((value) => value !== '');
  const args: string[] = [];
  if (source.kind === 'create') {
    args.push('--create', source.lattice, ...filled(source.parameters));
    if (source.orientation.length > 0) args.push('orient', ...source.orientation);
  } else {
    args.push(source.path);
  }
  for (const option of options) args.push(option.flag, ...filled(option.arguments));
  // Overwrite without asking, atomsk would otherwise wait for an answer on stdin.
  args.push(output, '-ow');
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

/** Runs atomsk `program` to write `destination` and returns its combined log.
 *  Atomsk runs in the output's directory, because some formats (VASP POSCAR) are always written to a fixed
 *  name in the working directory. It cannot write over its own input, so that case writes into a temporary
 *  directory next to the destination, keeping the file name (atomsk picks some formats by exact name), then renames. */
export async function writeStructure(
  program: string,
  source: Source,
  options: OptionInvocation[],
  destination: string,
): Promise<{ success: boolean; log: string }> {
  destination = path.resolve(destination);
  // Resolved against the caller's directory, since atomsk runs elsewhere.
  // ponytail: file names inside option arguments (-merge, -properties…) stay as typed; the catalog does not mark
  // which arguments are files. Use absolute paths there.
  if (source.kind === 'file') source = { kind: 'file', path: path.resolve(source.path) };
  const directory = path.dirname(destination);
  if (!isDirectory(directory)) return { success: false, log: `The output folder ${directory} does not exist.\n` };
  let temporaryDirectory: string | undefined;
  try {
    if (source.kind === 'file' && samePath(source.path, destination)) {
      temporaryDirectory = fs.mkdtempSync(path.join(directory, '.atomsk-gui-'));
    }
  } catch (error) {
    return { success: false, log: `Cannot create a temporary folder in ${directory}: ${errorMessage(error)}\n` };
  }
  const output = temporaryDirectory ? path.join(temporaryDirectory, path.basename(destination)) : destination;
  const args = buildArguments(source, options, output);
  let log = `$ ${program} ${args.join(' ')}\n`;
  try {
    try {
      const result = await capture(program, args, path.dirname(output));
      log += result.output;
      if (!result.success) return { success: false, log };
    } catch (error) {
      return { success: false, log: `${log}Cannot run ${program}: ${errorMessage(error)}\n` };
    }
    if (temporaryDirectory) fs.renameSync(output, destination);
    return { success: true, log };
  } catch (error) {
    return { success: false, log: `${log}Cannot replace ${destination}: ${errorMessage(error)}\n` };
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
