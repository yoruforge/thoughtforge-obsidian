import * as fs from "fs";
import * as path from "path";

export type VaultBinding = Readonly<{
  adapterBasePath: string; canonicalRoot: string; rootDev: string; rootIno: string;
  rootBirthtimeNs: string; vaultName: string; configDir: string;
}>;
const unsafe = 'この保存先の安全性を確認できないため、保存を停止しました。入力はコピーできます。';

// The only production Node filesystem boundary. Certification checks geometry,
// not user permission; main always combines it with EditPermission admission.
export class WriteTargetGuard {
  private certified = false;
  private revoked = false;
  private configDir: () => string = () => '.obsidian';
  private vaultName: () => string = () => 'Vault';
  private basePath: () => string | undefined = () => this.root;
  private certifiedBinding?: VaultBinding;
  onRevoked?: () => void;
  constructor(private root?: string) {}
  get authorized(): boolean { return this.certified && !this.revoked; }

  contextMatches(): boolean {
    const binding = this.certifiedBinding;
    return !!binding && this.basePath() === binding.adapterBasePath && this.configDir() === binding.configDir && this.vaultName() === binding.vaultName;
  }
  async inspectBinding(): Promise<VaultBinding> {
    const base = this.basePath();
    if (!base || !path.isAbsolute(base) || base !== this.root) throw Error('adapter');
    const canonicalRoot = await fs.promises.realpath(base);
    if (canonicalRoot !== base) throw Error('root');
    const stat = await fs.promises.lstat(base, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory() || typeof stat.ino !== 'bigint' || typeof stat.birthtimeNs !== 'bigint' || stat.ino <= 0n || stat.birthtimeNs <= 0n) throw Error('root identity');
    const vaultName = this.vaultName(), configDir = this.configDir();
    if (!vaultName || vaultName.includes('\0') || !configDir) throw Error('binding');
    return { adapterBasePath: base, canonicalRoot, rootDev: String(stat.dev), rootIno: String(stat.ino),
      rootBirthtimeNs: String(stat.birthtimeNs), vaultName, configDir };
  }
  async certify(basePath: string | undefined, configDir: () => string = () => '.obsidian',
    vaultName: () => string = () => 'Vault', liveBasePath: () => string | undefined = () => basePath): Promise<boolean> {
    if (this.revoked) return false;
    try {
      if (this.root && basePath !== this.root) throw Error('adapter');
      this.root = basePath; this.basePath = liveBasePath; this.configDir = configDir; this.vaultName = vaultName;
      const binding = await this.inspectBinding(), settings = binding.configDir, parts = settings.split('/');
      if (path.isAbsolute(settings) || !parts.some(part => part.startsWith('.')) ||
          parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw Error('settings');
      let current = binding.canonicalRoot;
      for (const part of parts) {
        current = path.join(current, part);
        const stat = await fs.promises.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('settings');
      }
      this.certifiedBinding = binding; this.certified = true; return true;
    } catch { this.revoke(); return false; }
  }
  private async checkBinding(): Promise<boolean> {
    try {
      const live = await this.inspectBinding(), previous = this.certifiedBinding;
      if (!previous || Object.keys(previous).some(key => previous[key as keyof VaultBinding] !== live[key as keyof VaultBinding])) throw Error('binding');
      return true;
    } catch { this.revoke(); return false; }
  }
  private revoke(): void {
    const first = !this.revoked;
    this.revoked = true;
    this.certified = false;
    if (first) this.onRevoked?.();
  }
  private within(target: string, directory: string): boolean {
    const relative = path.relative(directory, target);
    return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  }
  /** data.json writes have the same root binding and path protections.
   * Only the plugin's exact installed data path is admitted, never a note path. */
  async checkPluginData(relativePath: string): Promise<string | undefined> {
    if (!this.authorized || !await this.checkBinding()) return unsafe;
    try {
      const parts = relativePath.split('/');
      if (relativePath !== `${this.certifiedBinding?.configDir}/plugins/thoughtforge/data.json` || path.isAbsolute(relativePath) || parts.length < 4 || parts.at(-3) !== 'plugins' || parts.at(-2) !== 'thoughtforge' || parts.at(-1) !== 'data.json' ||
        parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) throw Error('path');
      let current = this.root!;
      for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]!);
        let stat;
        try { stat = await fs.promises.lstat(current); }
        catch (error) { if (i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
        if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw Error('target');
        if (await fs.promises.realpath(current) !== current) throw Error('realpath');
      }
      return undefined;
    } catch { return unsafe; }
  }
  async check(relativePath: string): Promise<string | undefined> {
    if (!this.authorized || !await this.checkBinding()) return unsafe;
    try {
      const parts = relativePath.split("/");
      // Match the Markdown view's case-sensitive suffix; settings are never notes.
      if (!relativePath.endsWith(".md") || path.isAbsolute(relativePath) ||
          parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.startsWith("."))) throw new Error("path");
      let current = this.root!;
      for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]!);
        const stat = await fs.promises.lstat(current);
        if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error("target");
        const resolved = await fs.promises.realpath(current);
        if (!this.within(resolved, this.root!)) throw new Error("outside");
        if (path.relative(this.root!, resolved).split(path.sep).some(part => part.startsWith("."))) throw new Error("hidden");
      }
      return undefined;
    } catch { return unsafe; }
  }
}
