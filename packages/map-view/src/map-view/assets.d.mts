export type MapViewScriptOptions = Readonly<{
  THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION: number;
  THOUGHTFORGE_MAP_DROP_BEFORE_RATIO: number;
  THOUGHTFORGE_MAP_DROP_AFTER_RATIO: number;
  /** JSON already escaped for an inline script. */
  readyMessage: string;
  /** JSON already escaped for an inline script. */
  initialSettings: string;
  /** JSON already escaped for an inline script. */
  documentUri: string;
}>;

export declare const mapViewCss: string;
export declare function resolveMapViewLocale(locale?: string): "en" | "ja";
export declare function getMapViewDocumentTitle(locale?: string): string;
export declare function renderMapViewMarkup(locale: string | undefined, escapedUri: string): string;
export declare function renderMapViewScript(options: MapViewScriptOptions): string;
export type { MapModel, MapIntent, MapCommandResult, MapInbound, MapHostPolicy, MapHostBridge, MapViewLifecycle } from "./bridge.mjs";
