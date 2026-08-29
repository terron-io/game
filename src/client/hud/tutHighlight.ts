import { UnitType } from "../../core/game/Game";

// terron: обучение подсвечивает нужную кнопку постройки снизу. TutorialCards ставит
// body-класс (tut-city / tut-income / tut-factory / tut-port / tut-defense), а
// UnitDisplay/BuildMenu вешают мигание (tut-hl-city) на СООТВЕТСТВУЮЩИЙ юнит.
export function tutHighlighted(t: UnitType): boolean {
  const b = document.body.classList;
  return (
    (t === UnitType.City && b.contains("tut-city")) ||
    ((t === UnitType.Factory || t === UnitType.Port) &&
      b.contains("tut-income")) ||
    (t === UnitType.Factory && b.contains("tut-factory")) ||
    (t === UnitType.Port && b.contains("tut-port")) ||
    (t === UnitType.DefensePost && b.contains("tut-defense"))
  );
}

// Активен ли шаг постройки обучения (какой-то из tut-*-классов на body).
export function tutBuildActive(): boolean {
  const b = document.body.classList;
  return (
    b.contains("tut-city") ||
    b.contains("tut-income") ||
    b.contains("tut-factory") ||
    b.contains("tut-port") ||
    b.contains("tut-defense")
  );
}

// terron: во время шага постройки строить МОЖНО только нужный тип — остальные
// кнопки блокируем (не даём строить лишнее). true = кнопку заблокировать.
export function tutBlocked(t: UnitType): boolean {
  return tutBuildActive() && !tutHighlighted(t);
}
