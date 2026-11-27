export class TFile {
  readonly path: string;
  readonly extension: string;
  readonly basename: string;

  constructor(filePath: string) {
    this.path = filePath;
    const slash = filePath.lastIndexOf('/');
    const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
    const dot = name.lastIndexOf('.');
    this.extension = dot > 0 ? name.slice(dot + 1) : '';
    this.basename = dot > 0 ? name.slice(0, dot) : name;
  }
}

export class TFolder {
  readonly path: string;
  readonly name: string;
  readonly children: Array<TFile | TFolder>;

  constructor(folderPath: string, children: Array<TFile | TFolder> = []) {
    this.path = folderPath;
    const slash = folderPath.lastIndexOf('/');
    this.name = slash >= 0 ? folderPath.slice(slash + 1) : folderPath;
    this.children = children;
  }

  isRoot(): boolean {
    return this.path === '/' || this.path === '';
  }
}

export interface StubMarkdownEditor {
  lastLine(): number;
  setCursor(pos: { line: number; ch: number }): void;
  scrollIntoView(
    range: { from: { line: number; ch: number }; to: { line: number; ch: number } },
    center?: boolean,
  ): void;
}

export class MarkdownView {
  file: TFile | null;
  data: string;
  private viewData: string;
  editor: StubMarkdownEditor;

  constructor(
    file: TFile | null = null,
    data = '',
    viewData = data,
    editor?: StubMarkdownEditor,
  ) {
    this.file = file;
    this.data = data;
    this.viewData = viewData;
    this.editor = editor ?? {
      lastLine: () => Math.max(0, this.viewData.split('\n').length - 1),
      setCursor: () => undefined,
      scrollIntoView: () => undefined,
    };
  }

  getViewData(): string {
    return this.viewData;
  }

  setViewData(data: string): void {
    this.viewData = data;
  }
}
