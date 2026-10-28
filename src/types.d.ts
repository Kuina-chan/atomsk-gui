// Global types shared by the main process, the preload script and the renderer.

/** Static description of lattices, options and file formats, read from `catalog.json`. */
type ParamKind = 'float' | 'int' | 'string' | 'species' | 'choice';

interface Param {
  label: string;
  kind: ParamKind;
  choices?: string[];
  optional?: boolean;
  default?: string;
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

interface Format {
  label: string;
  extensions: string[];
  read: boolean;
  write: boolean;
}

interface Catalog {
  lattices: Lattice[];
  options: AtomskOption[];
  formats: Format[];
}

/** Where the structure comes from. `orientation` is empty or the three Miller-index directions after `orient`. */
type Source =
  | { kind: 'create'; lattice: string; parameters: string[]; orientation: string[] }
  | { kind: 'file'; path: string };

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
}

type MenuCommand = 'new' | 'save' | 'save-as';

/** Exposed by the preload script as `window.atomsk`. */
interface AtomskApi {
  catalog(): Promise<Catalog>;
  /** Files passed on the command line, one tab each. */
  initialFiles(): Promise<string[]>;
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
