// terron: «политические» префиксы нации-сепаратиста (ульта Раскол). КАНОН в
// симуляции — АНГЛИЙСКИЙ (детерминизм: имя генерится в воркере и должно быть
// одинаковым у всех клиентов; воркер не знает выбранный язык — L()/translateText
// читают DOM <lang-selector>, которого в воркере нет). RU-перевод накладывается
// на КЛИЕНТЕ при отображении (localizeSeparatistName в client/LocalizeNames). Русские
// формы женского рода — согласуются как «… {страна}». Спека: new-units/SPLIT.md
export const SPLIT_NATION_PREFIXES: { en: string; ru: string }[] = [
  { en: "Independent", ru: "Независимая" },
  { en: "Free", ru: "Свободная" },
  { en: "Democratic", ru: "Демократическая" },
  { en: "Liberated", ru: "Освобождённая" },
  { en: "People's", ru: "Народная" },
  { en: "Unbound", ru: "Вольная" },
  { en: "Sovereign", ru: "Суверенная" },
  { en: "Rebel", ru: "Мятежная" },
  { en: "Insurgent", ru: "Восставшая" },
  { en: "Autonomous", ru: "Автономная" },
];
