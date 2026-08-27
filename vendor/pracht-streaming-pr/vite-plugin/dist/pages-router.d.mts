//#region src/pages-router.d.ts
interface ScannedPage {
  absolutePath: string;
  relativePath: string;
  routePath: string;
  isIndex: boolean;
  isCatchAll: boolean;
  isDynamic: boolean;
  renderMode?: string;
  hydrationMode?: string;
  revalidateSeconds?: number;
  hasRevalidateExport?: boolean;
  hasLoader?: boolean;
  hasHead?: boolean;
  hasHeaders?: boolean;
}
interface PagesRouterOptions {
  pagesDir: string;
  pagesDefaultRender?: string;
  additionalExtensions?: readonly string[];
}
declare function scanPagesDirectory(pagesDir: string, additionalExtensions?: readonly string[]): ScannedPage[];
declare function filePathToRoutePath(relativePath: string): string;
declare function sortRoutes(pages: ScannedPage[]): ScannedPage[];
declare function generatePagesManifestSource(pages: ScannedPage[], options: PagesRouterOptions & {
  pagesDirPrefix?: string;
  useImportSyntax?: boolean;
}): string;
declare function generateRoutesFile(pagesDir: string, outputPath: string, options: PagesRouterOptions): void;
//#endregion
export { PagesRouterOptions, ScannedPage, filePathToRoutePath, generatePagesManifestSource, generateRoutesFile, scanPagesDirectory, sortRoutes };