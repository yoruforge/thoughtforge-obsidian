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
