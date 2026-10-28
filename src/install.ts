// Downloads and installs the official prebuilt atomsk. No Electron dependency, shells out to `tar`.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { executableName, isFile, verifyAtomsk } from './command';

export const DOWNLOAD_PAGE = 'https://atomsk.univ-lille.fr/dl.php';
const SITE = 'https://atomsk.univ-lille.fr/';

/** Ending of the official archive for this platform. Only Linux x86_64 ships a portable binary:
 *  the Windows zip holds just an installer (`Atomsk_setup.exe`) and macOS has no build. */
function platformArchiveSuffix(): string | undefined {
  return process.platform === 'linux' && process.arch === 'x64' ? '_Linux-amd64.tar.gz' : undefined;
}

/** The GitHub repository has no releases, so the links come from the download page.
 *  Its hrefs contain a stray line break (`atomsk_b0.13.1\n_Linux-amd64.tar.gz`) that browsers ignore. */
export function pickArchiveUrl(page: string, suffix: string): string | undefined {
  const name = page
    .split('href="./code/')
    .slice(1)
    .map((rest) => rest.split('"')[0].replace(/[\r\n]/g, ''))
    .find((name) => name.startsWith('atomsk_') && name.endsWith(suffix));
  return name && `${SITE}code/${name}`;
}

async function download(url: string): Promise<Buffer> {
  // ponytail: one deadline for the whole transfer; the archive is a few MB.
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** URL of the official archive for this platform; throws with the reason when there is none. */
export async function resolveArchiveUrl(): Promise<string> {
  const suffix = platformArchiveSuffix();
  if (!suffix) throw new Error('The atomsk website offers no portable prebuilt binary for this platform.');
  const url = pickArchiveUrl((await download(DOWNLOAD_PAGE)).toString('utf8'), suffix);
  if (!url) throw new Error('No download link for this platform on the atomsk download page.');
  return url;
}

/** Looks for `name` in `directory`, files first, then subdirectories (`man/atomsk` is not the binary). */
export function findFile(directory: string, name: string): string | undefined {
  const candidate = path.join(directory, name);
  if (isFile(candidate)) return candidate;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const found = entry.isDirectory() ? findFile(path.join(directory, entry.name), name) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** Downloads `url` into `workDirectory`, extracts it and installs the atomsk executable into
 *  `installDirectory`. Returns the installed path, already checked with `--version`. */
export async function downloadAndInstall(url: string, workDirectory: string, installDirectory: string): Promise<string> {
  try {
    return await install(url, workDirectory, installDirectory);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

async function install(url: string, workDirectory: string, installDirectory: string): Promise<string> {
  fs.rmSync(workDirectory, { recursive: true, force: true });
  const extracted = path.join(workDirectory, 'extracted');
  fs.mkdirSync(extracted, { recursive: true });
  const archive = path.join(workDirectory, 'archive');
  fs.writeFileSync(archive, await download(url));
  try {
    await promisify(execFile)('tar', ['-xf', archive, '-C', extracted], { windowsHide: true });
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message: string };
    throw new Error(`tar failed: ${(stderr || message).trim()}`);
  }

  const binary = findFile(extracted, executableName());
  if (!binary) throw new Error('The archive does not contain an atomsk executable.');
  fs.mkdirSync(installDirectory, { recursive: true });
  const installed = path.join(installDirectory, executableName());
  fs.copyFileSync(binary, installed);
  fs.chmodSync(installed, 0o755);
  await verifyAtomsk(installed);
  return installed;
}
