import * as fs from 'node:fs';
import * as path from 'node:path';

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog.json'), 'utf8'));

// Missing optional fields get the same defaults the Rust loader (serde) used, so callers never see undefined.
export const catalog: Catalog = {
  lattices: raw.lattices.map((lattice: Lattice) => ({ ...lattice, description: lattice.description ?? '', params: lattice.params ?? [] })),
  options: raw.options.map((option: AtomskOption) => ({ ...option, description: option.description ?? '', args: option.args ?? [] })),
  modes: (raw.modes ?? []).map((mode: Mode) => ({ ...mode, description: mode.description ?? '', args: mode.args ?? [] })),
  formats: raw.formats,
};
