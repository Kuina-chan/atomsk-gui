// Renderer: tabs and the per-structure input form. Plain script (no imports), it reaches the
// main process only through `window.atomsk`, which runs atomsk and owns every native dialog.

const api = window.atomsk;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
}

function fileName(file: string): string {
  return file.split(/[\\/]/).pop()!;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let dropdownCount = 0;

/**
 * A text box whose suggestion list narrows down as the user types; `onSelect` gets the index of the picked label.
 * The list is a plain element with `overflow-y` rather than a `<datalist>`: Chromium's native datalist popup
 * cannot be scrolled with the mouse wheel, which made long catalogs (the options list has dozens of entries) hard
 * to browse. A plain list also lets the popup use the app's theme colors.
 */
function searchableDropdown(labels: string[], onSelect: (index: number) => void, initial?: number) {
  const input = element('input', {
    className: 'dropdown-input', placeholder: 'Type to search…', autocomplete: 'off', spellcheck: false,
  });
  const list = element('div', { className: 'dropdown-list', hidden: true });
  list.id = `dropdown-list-${++dropdownCount}`;
  list.setAttribute('role', 'listbox');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  const root = element('span', { className: 'dropdown' }, input, list);

  let selected = initial;
  let open = false;
  /** Indexes into `labels` of the options matching what is typed. */
  let matches: number[] = [];
  /** Position within `matches` of the keyboard-highlighted option. */
  let highlighted = -1;

  const showSelected = () => {
    input.value = selected === undefined ? '' : labels[selected];
    input.placeholder = 'Type to search…';
  };

  const setHighlighted = (position: number) => {
    highlighted = position;
    const options = list.children;
    for (let index = 0; index < options.length; index++) {
      options[index].classList.toggle('highlighted', index === highlighted);
    }
    const option = options[highlighted];
    if (option instanceof HTMLElement) {
      input.setAttribute('aria-activedescendant', option.id);
      // Keep the keyboard choice visible inside the scrollable list.
      option.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const close = () => {
    open = false;
    list.hidden = true;
    root.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    highlighted = -1;
  };

  const render = () => {
    const query = input.value.trim().toLowerCase();
    matches = labels.map((_, index) => index).filter((index) => labels[index].toLowerCase().includes(query));
    const options: HTMLDivElement[] = matches.map((index, position) => {
      const option = element('div', { className: 'dropdown-option', textContent: labels[index], title: labels[index] });
      option.id = `${list.id}-${position}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === selected));
      // The input keeps focus, so a plain click would blur it and close the list before the click is handled.
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(index);
      });
      return option;
    });
    if (options.length === 0) {
      const empty = element('div', { className: 'dropdown-option empty', textContent: 'No matches' });
      empty.setAttribute('aria-disabled', 'true');
      options.push(empty);
    }
    list.replaceChildren(...options);
    setHighlighted(-1);
  };

  const openList = () => {
    if (!open) {
      open = true;
      list.hidden = false;
      root.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    render();
    const position = selected === undefined ? -1 : matches.indexOf(selected);
    setHighlighted(position);
  };

  const choose = (index: number) => {
    const changed = index !== selected;
    selected = index;
    input.value = labels[index];
    input.placeholder = 'Type to search…';
    close();
    if (changed) onSelect(index);
  };

  showSelected();
  input.addEventListener('focus', () => {
    // An exact value would filter the list down to itself: start empty, keep the choice as a hint.
    input.placeholder = input.value || input.placeholder;
    input.value = '';
    openList();
  });
  input.addEventListener('click', () => {
    // Escape closes the list but keeps focus; clicking the box should reopen it.
    if (!open) {
      input.value = '';
      openList();
    }
  });
  input.addEventListener('input', () => {
    openList();
    // Preserve the old datalist behaviour: typing an exact label applies it immediately.
    const exact = labels.indexOf(input.value);
    if (exact >= 0) {
      if (exact !== selected) {
        selected = exact;
        onSelect(exact);
      }
      setHighlighted(matches.indexOf(exact));
    }
  });
  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        if (matches.length > 0) setHighlighted((highlighted + 1) % matches.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        if (matches.length > 0) setHighlighted(highlighted <= 0 ? matches.length - 1 : highlighted - 1);
        break;
      case 'Enter':
        if (!open) return;
        event.preventDefault();
        if (highlighted >= 0) choose(matches[highlighted]);
        else if (matches.length === 1) choose(matches[0]);
        else close();
        break;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        close();
        showSelected();
        break;
      case 'Tab':
        if (!open) return;
        close();
        showSelected();
        break;
    }
  });
  input.addEventListener('blur', () => {
    close();
    showSelected();
  });
  return { root, input };
}

function descriptionLabel(text = ''): HTMLParagraphElement {
  return element('p', { className: 'description', textContent: text, hidden: text === '' });
}

/** Shows `text` under the dropdown and as its tooltip; hidden when there is nothing to show. */
function setDescription(label: HTMLElement, input: HTMLInputElement, text: string): void {
  label.textContent = text;
  label.hidden = text === '';
  input.title = text;
}

// ------------------------------------------------------------ parameters

/** One input (with its label) for a lattice or option parameter. */
interface ParamField {
  param: Param;
  row: HTMLElement;
  value(): string;
}

function isFilled(field: ParamField): boolean {
  return Boolean(field.param.optional) || field.value() !== '';
}

const PLACEHOLDERS: Partial<Record<ParamKind, string>> = { float: 'number', int: 'integer', species: 'element symbol' };

function paramField(param: Param, onChange: () => void): ParamField {
  const row = element('label', { className: 'param' }, element('span', { textContent: param.optional ? `${param.label} (optional)` : param.label }));
  const choices = param.choices ?? [];
  // A single-choice parameter is a fixed keyword: shown read-only, always emitted.
  if (param.kind === 'choice' && !param.optional && choices.length === 1) {
    row.append(element('span', { className: 'description', textContent: choices[0] }));
    return { param, row, value: () => choices[0] };
  }
  if (param.kind === 'choice') {
    const values = param.optional ? ['', ...choices] : choices;
    let selected = Math.max(0, values.indexOf(param.default ?? ''));
    const dropdown = searchableDropdown(values.map((value) => value || '(none)'), (index) => {
      selected = index;
      onChange();
    }, selected);
    dropdown.input.title = param.label;
    row.append(dropdown.root);
    return { param, row, value: () => values[selected] };
  }
  const input = element('input', { placeholder: PLACEHOLDERS[param.kind] ?? 'text', title: param.label, value: param.default ?? '' });
  input.addEventListener('input', onChange);
  row.append(input);
  return { param, row, value: () => input.value.trim() };
}

/** Replaces the content of `container` with one field per parameter. */
function fillParams(container: HTMLElement, params: Param[], onChange: () => void): ParamField[] {
  const fields = params.map((param) => paramField(param, onChange));
  container.replaceChildren(...fields.map((field) => field.row));
  return fields;
}

/** Optional `orient` directions of `--create`; they are not part of the catalog. */
const ORIENTATION_PARAMS: Param[] = ['X', 'Y', 'Z'].map((axis) => ({
  label: `Orientation along ${axis} (e.g. [100])`, kind: 'string', optional: true,
}));

// ------------------------------------------------------------------- tab

/** One added option: a searchable option dropdown followed by its argument fields. */
interface OptionRow {
  container: HTMLElement;
  fields: ParamField[];
  /** Catalog index of the option `fields` were built for. */
  optionIndex?: number;
}

/** One structure being edited. */
class Tab {
  /** Set when the tab was created from an opened file. */
  sourcePath?: string;
  /** Where a new structure was last saved; Ctrl+S writes there. */
  savedPath?: string;
  dirty = false;
  readonly page: HTMLElement;
  readonly header: HTMLElement;
  /** Tab header text: the file the tab saves to, once there is one. */
  private readonly title = element('span');
  private readonly editingLabel = element('p', { className: 'editing' });
  private latticeFields: ParamField[] = [];
  private latticeIndex?: number;
  private readonly orientFields: ParamField[];
  private readonly optionsSection = element('section', {}, element('h2', { textContent: 'Options' }));
  private readonly optionsList = element('div', { className: 'options' });
  private optionRows: OptionRow[] = [];
  private readonly logDetails = element('details', {}, element('summary', { textContent: 'Log' }));
  private readonly logView = element('pre', { className: 'log' });
  /** Enabled by the first log line. */
  private readonly copyLogButton = element('button', { textContent: 'Copy log', disabled: true, onclick: () => {
    void navigator.clipboard.writeText(this.logView.textContent ?? '');
  } });

  constructor(private readonly workspace: Workspace, sourcePath: string | undefined, title: string) {
    this.sourcePath = sourcePath;
    this.editingLabel.hidden = !sourcePath;
    if (sourcePath) this.editingLabel.textContent = `Editing ${sourcePath}`;

    const onChange = () => this.changed();
    const catalog = workspace.catalog;
    const latticeDescription = descriptionLabel();
    const latticeParams = element('div', { className: 'params' });
    const orientBox = element('div', { className: 'params', hidden: true });
    this.orientFields = fillParams(orientBox, ORIENTATION_PARAMS, onChange);
    const latticeDropdown = searchableDropdown(catalog.lattices.map((lattice) => lattice.label), (index) => {
      const lattice = catalog.lattices[index];
      setDescription(latticeDescription, latticeDropdown.input, lattice.description);
      this.latticeFields = fillParams(latticeParams, lattice.params, onChange);
      this.latticeIndex = index;
      orientBox.hidden = false;
      this.changed();
    });
    const latticeSection = element('section', { hidden: Boolean(sourcePath) },
      element('h2', { textContent: 'Crystal lattice' }), latticeDropdown.root, latticeDescription, latticeParams, orientBox);

    // A new structure reveals the options only once the lattice parameters are filled in.
    this.optionsSection.hidden = !sourcePath;
    this.optionsSection.append(this.optionsList, element('button', { textContent: 'Add option', onclick: () => this.addOptionRow() }));

    // Same actions as the File menu entries.
    const saveButtons = element('div', { className: 'save-buttons' },
      element('button', { textContent: 'Save as…', onclick: () => void this.save(true) }),
      element('button', { textContent: 'Save', className: 'suggested', onclick: () => void this.save(false) }));

    this.logDetails.append(this.copyLogButton, this.logView);

    this.page = element('div', { className: 'page' },
      this.editingLabel, latticeSection, this.optionsSection, saveButtons, this.logDetails);
    this.title.textContent = title;
    this.header = element('div', { className: 'tab', onclick: () => workspace.select(this) },
      this.title,
      element('button', { className: 'close', textContent: '×', title: 'Close this structure', onclick: (event: MouseEvent) => {
        event.stopPropagation();
        void workspace.askToClose(this);
      } }));
  }

  /** Called by every input: marks the tab modified and re-checks the form. */
  private changed(): void {
    this.dirty = true;
    this.workspace.reportDirty();
    const latticeReady = this.latticeIndex !== undefined && this.latticeFields.every(isFilled);
    this.optionsSection.hidden = !(this.sourcePath || latticeReady);
  }

  private addOptionRow(): void {
    const catalog = this.workspace.catalog;
    const description = descriptionLabel();
    const argumentsBox = element('div', { className: 'params' });
    const row: OptionRow = { container: element('div', { className: 'option' }), fields: [] };
    const dropdown = searchableDropdown(catalog.options.map((option) => `${option.flag} - ${option.label}`), (index) => {
      setDescription(description, dropdown.input, catalog.options[index].description);
      row.fields = fillParams(argumentsBox, catalog.options[index].args, () => this.changed());
      row.optionIndex = index;
      this.changed();
    });
    const removeButton = element('button', { textContent: '−', title: 'Remove this option', onclick: () => {
      row.container.remove();
      this.optionRows = this.optionRows.filter((other) => other !== row);
      this.changed();
    } });
    row.container.append(element('div', { className: 'option-header' }, dropdown.root, removeButton), description, argumentsBox);
    this.optionsList.append(row.container);
    this.optionRows.push(row);
    this.changed();
    dropdown.input.focus();
  }

  /** Reads the form; throws a message for the user. */
  private collect(): { source: Source; options: OptionInvocation[] } {
    let source: Source;
    if (this.sourcePath) {
      source = { kind: 'file', path: this.sourcePath };
    } else {
      if (this.latticeIndex === undefined) throw new Error('Choose a crystal lattice first.');
      const missing = this.latticeFields.find((field) => !isFilled(field));
      if (missing) throw new Error(`Fill in "${missing.param.label}".`);
      const orientation = this.orientFields.map((field) => field.value());
      const filled = orientation.filter((value) => value !== '').length;
      if (filled !== 0 && filled !== 3) throw new Error('Orientation needs all three directions, or none.');
      source = {
        kind: 'create',
        lattice: this.workspace.catalog.lattices[this.latticeIndex].id,
        parameters: this.latticeFields.map((field) => field.value()),
        orientation: filled === 3 ? orientation : [],
      };
    }
    const options = this.optionRows.map((row) => {
      if (row.optionIndex === undefined) throw new Error('Choose an option for every added option, or remove it.');
      const option = this.workspace.catalog.options[row.optionIndex];
      const missing = row.fields.find((field) => !isFilled(field));
      if (missing) throw new Error(`Option ${option.flag}: fill in "${missing.param.label}".`);
      return { flag: option.flag, arguments: row.fields.map((field) => field.value()) };
    });
    return { source, options };
  }

  private appendLog(text: string): void {
    this.logView.append(text.endsWith('\n') ? text : `${text}\n`);
    this.copyLogButton.disabled = false;
  }

  /** Save: back to the opened or last saved file, or ask where. Save as: always ask; the output extension picks the format. */
  async save(saveAs: boolean): Promise<void> {
    // The form stays locked until atomsk is done, so nothing edited meanwhile is wrongly marked saved or dropped.
    if (this.page.inert) return;
    let collected;
    try {
      collected = this.collect();
    } catch (error) {
      return api.showError('Cannot save yet', errorText(error));
    }
    this.page.inert = true;
    let result;
    try {
      result = await api.save({ ...collected, knownPath: saveAs ? undefined : this.sourcePath ?? this.savedPath });
    } catch (error) {
      return api.showError('Cannot save', errorText(error));
    } finally {
      this.page.inert = false;
    }
    if (!result) return;
    this.appendLog(result.log);
    if (!result.savedTo) {
      this.logDetails.open = true;
      return;
    }
    this.appendLog(`Saved ${result.savedTo}`);
    this.title.textContent = fileName(result.savedTo);
    this.dirty = false;
    this.workspace.reportDirty();
    if (this.sourcePath) {
      // The options are now part of the file; applying them again would double them.
      this.optionRows.forEach((row) => row.container.remove());
      this.optionRows = [];
      this.editingLabel.textContent = `Editing ${result.savedTo}`;
      this.sourcePath = result.savedTo;
    } else {
      this.savedPath = result.savedTo;
    }
  }
}

// ------------------------------------------------------------- workspace

class Workspace {
  private tabs: Tab[] = [];
  private current?: Tab;
  private untitledCount = 0;

  constructor(readonly catalog: Catalog, private readonly tabStrip: HTMLElement, private readonly pages: HTMLElement) {}

  addTab(file?: string): void {
    const title = file ? fileName(file) : `New structure ${++this.untitledCount}`;
    const tab = new Tab(this, file, title);
    this.tabs.push(tab);
    this.tabStrip.append(tab.header);
    this.pages.append(tab.page);
    this.select(tab);
  }

  select(tab: Tab): void {
    this.current = tab;
    for (const other of this.tabs) {
      other.page.hidden = other !== tab;
      other.header.classList.toggle('current', other === tab);
    }
  }

  async askToClose(tab: Tab): Promise<void> {
    const detail = tab.dirty ? 'This structure has unsaved changes.' : '';
    if (!await api.confirm('Close this structure?', detail, 'Close')) return;
    const index = this.tabs.indexOf(tab);
    this.tabs.splice(index, 1);
    tab.header.remove();
    tab.page.remove();
    this.reportDirty();
    if (this.tabs.length === 0) this.addTab();
    else if (tab === this.current) this.select(this.tabs[Math.min(index, this.tabs.length - 1)]);
  }

  reportDirty(): void {
    api.setDirty(this.tabs.some((tab) => tab.dirty));
  }

  run(menuCommand: MenuCommand): void {
    if (menuCommand === 'new') this.addTab();
    else void this.current?.save(menuCommand === 'save-as');
  }
}

async function start(): Promise<void> {
  const workspace = new Workspace(await api.catalog(), document.getElementById('tabs')!, document.getElementById('pages')!);
  api.onMenu((menuCommand) => workspace.run(menuCommand));
  api.onOpenFile((file) => workspace.addTab(file));
  const busy = document.getElementById('busy') as HTMLDialogElement;
  busy.addEventListener('cancel', (event) => event.preventDefault());
  api.onBusy((message) => {
    if (message === null) return busy.close();
    busy.querySelector('p')!.textContent = message;
    busy.showModal();
  });
  const files = await api.initialFiles();
  if (files.length === 0) workspace.addTab();
  files.forEach((file) => workspace.addTab(file));
}

start().catch((error) => void api.showError('Atomsk GUI failed to start', errorText(error)));
