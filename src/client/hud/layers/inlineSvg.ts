// terron (офлайн iOS): build-time инлайн SVG (?raw) в data:-URL. URL ассета через
// assetUrl() зависит от origin/манифеста (фиксируется на загрузке модулей) и ломается
// в офлайн-бандле / при origin-переходах без перезапуска (иконка грузится из протухшего
// URL → пусто). data:-URL самодостаточен — не зависит от сети/origin. См. OFFLINE-IOS.md.
export function svgDataUrl(raw: string): string {
  return "data:image/svg+xml," + encodeURIComponent(raw);
}
