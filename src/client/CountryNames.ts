// terron: названия флагов на языке интерфейса.
//
// ЗАЧЕМ. В `resources/countries.json` имя одно — английское, и русский игрок
// видел «Russia / Belarus / Germany» в полностью русском меню (замечание
// модерации VK 25.08.2026), а поиск по слову «Россия» не находил ничего.
// Перевод лежит вторым полем `name_ru` (генератор — `scripts/gen-country-names-ru.mjs`),
// английское имя остаётся базой: канон мультиязычности — база EN + RU-оверлей.
//
// Отдельный модуль, а не пара строк по месту: имя страны показывают И витрина
// флагов, И панель игрока в матче, а искать надо сразу по обоим языкам.

import { getCurrentLang } from "./Utils";

/** Запись страны из countries.json (полей больше, нам хватает этих). */
export interface CountryLike {
  code: string;
  name: string;
  name_ru?: string;
}

/** Имя для показа: русское — только когда интерфейс русский и перевод есть. */
export function countryName(c: CountryLike): string {
  if (getCurrentLang() === "ru" && c.name_ru) return c.name_ru;
  return c.name;
}

/**
 * Совпадение со строкой поиска. Ищем ПО ОБОИМ языкам и по коду независимо от
 * текущего языка: игрок может печатать «Russia» в русском интерфейсе (так же
 * называется файл флага) и «Россия» — в английском.
 */
export function countryMatchesSearch(c: CountryLike, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    c.name.toLowerCase().includes(q) ||
    (c.name_ru ?? "").toLowerCase().includes(q) ||
    c.code.toLowerCase().includes(q)
  );
}
