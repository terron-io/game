// terron 23.09: косметика ЧЕСТНЫХ БОТОВ лобби /fair (new-units/FAIRBOT.md).
//
// У бота нет клиента, поэтому косметика не приходит с сервера, как у людей, —
// её строит клиент из ростера (FairBotRoster) по списку персон в конфиге матча.
// Ключ — имя в симуляции, как у наций (GameView ищет косметику по clientID, а
// нет его — по имени). Флаг — на подписи, тот же флаг без рамки — скином на
// территории (cover: флаг закрывает зону целиком, как у named-скинов).
import { fairBotByKey } from "../core/execution/fairbot/FairBotRoster";
import { PlayerCosmetics } from "../core/Schemas";

/** Режим скина «cover» (territory.frag.glsl, skinMode 2). */
const SKIN_MODE_COVER = 2;
/** Насыщенность скина: как у дефолта редактора скинов (SkinsPage.dimPct = 90). */
const SKIN_DIM = 0.9;

export function fairBotCosmetics(
  keys: readonly string[] | undefined,
): Array<[string, PlayerCosmetics]> {
  const out: Array<[string, PlayerCosmetics]> = [];
  for (const key of keys ?? []) {
    const p = fairBotByKey(key);
    if (p === undefined) continue;
    out.push([
      p.en,
      {
        flag: `/flags/${p.flag}.svg`,
        customSkin: {
          url: p.skin,
          mode: SKIN_MODE_COVER,
          dim: SKIN_DIM,
          tileTiles: 8,
          aspect: p.skinAspect,
        },
      },
    ]);
  }
  return out;
}
