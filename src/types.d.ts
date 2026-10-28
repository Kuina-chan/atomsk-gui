// Global types shared by the main process, the preload script and the renderer.

/** Static description of lattices, options, modes and file formats, read from `catalog.json`. */
type ParamKind = 'float' | 'int' | 'string' | 'species' | 'choice' | 'file' | 'files' | 'list';

interface Param {
  name: string;
  label: string;
  kind: ParamKind;
  choices?: string[];
  optional?: boolean;
  default?: string;
  /** Minimum number of paths for `files` and `list`. */
  min?: number;
}

interface Lattice {
  id: string;
  label: string;
  description: string;
  params: Param[];
}

interface AtomskOption {
  flag: string;
  label: string;
  description: string;
  args: Param[];
}

/** How a mode writes its result: one file, several files sharing a prefix, numbered snapshots, files in a folder, or no file. */
type ModeOutput = 'file' | 'prefix' | 'numbered' | 'folder' | 'none';

interface Mode {
  id: string;
  flag: string;
  label: string;
  description: string;
  args: Param[];
  output: ModeOutput;
  /** `merge` needs the number of files before the list. */
  countFiles?: boolean;
  /** Options always passed unless the user added them, e.g. -wrap for modes that require wrapped coordinates. */
  autoOptions?: string[];
  /** Extension forced by the mode (ddplot writes .dd). */
  outputExtension?: string;
}

interface Format {
  id: string;
  label: string;
  extensions: string[];
  read: boolean;
  write: boolean;
  /** Keyword Atomsk expects on the command line, when it differs from `id`. */
  keyword?: string;
}

interface Catalog {
  lattices: Lattice[];
  options: AtomskOption[];
  modes: Mode[];
  formats: Format[];
}

/** Where the structure comes from. `orientation` is empty or the three Miller-index directions after `orient`. */
type Source =
  | { kind: 'create'; lattice: string; parameters: string[]; orientation: string[] }
  | { kind: 'file'; path: string }
  | { kind: 'mode'; mode: string; values: Record<string, string | string[]> };

interface OptionInvocation {
  flag: string;
  arguments: string[];
}

interface SaveRequest {
  source: Source;
  options: OptionInvocation[];
  /** Where to write; the main process asks with a save dialog when missing. */
  knownPath?: string;
}

/** `savedTo` is missing when atomsk failed; the main process has already shown the error. */
interface SaveResult {
  log: string;
  savedTo?: string;
  /** What the mode wrote; defaults to 'file' when missing. */
  output?: ModeOutput;
}

type MenuCommand = 'new' | 'save' | 'save-as';

/** Exposed by the preload script as `window.atomsk`. */
interface AtomskApi {
  catalog(): Promise<Catalog>;
  /** Files passed on the command line, one tab each. */
  initialFiles(): Promise<string[]>;
  /** Native open dialog; empty when the user cancelled. */
  pickFiles(multiple: boolean): Promise<string[]>;
  /** Resolves to undefined when the user cancelled. */
  save(request: SaveRequest): Promise<SaveResult | undefined>;
  showError(message: string, detail: string): Promise<void>;
  confirm(message: string, detail: string, acceptLabel: string): Promise<boolean>;
  setDirty(dirty: boolean): void;
  onMenu(listener: (command: MenuCommand) => void): void;
  onOpenFile(listener: (path: string) => void): void;
  /** `message` while a long task runs, null once it is over. */
  onBusy(listener: (message: string | null) => void): void;
}

interface Window {
  atomsk: AtomskApi;
}
