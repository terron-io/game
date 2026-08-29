import { GameStartInfo } from "../core/Schemas";

// terron: соответствие «игрок в матче → аккаунт на сайте» на стороне КЛИЕНТА.
//
// Зачем отдельный реестр: аватарку игрока в панели рисует HUD, а симуляция об
// аккаунтах ничего не знает и знать не должна (детерминизм). Публичный хэндл
// (users.slug) приезжает в стартовой информации матча — Player.publicId, — и
// мы просто складываем clientID → publicId один раз на старте.
//
// Только залогиненные: у анонима publicId нет, панель покажет базовый портрет
// по seed, как и раньше.

const byClientID = new Map<string, string>();

export function setMatchAccounts(info: GameStartInfo | undefined): void {
  byClientID.clear();
  for (const p of info?.players ?? []) {
    if (p.publicId) byClientID.set(p.clientID, p.publicId);
  }
}

export function clearMatchAccounts(): void {
  byClientID.clear();
}

/** Публичный хэндл (slug) игрока матча или null, если это аноним/бот. */
export function accountSlugForClient(
  clientID: string | null | undefined,
): string | null {
  if (!clientID) return null;
  return byClientID.get(clientID) ?? null;
}
