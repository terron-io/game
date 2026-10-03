// terron 27.08: УЧЁТ СЛОТОВ ИНСТАНС-БУФЕРА.
//
// Вынесено из UnitPass отдельным ЧИСТЫМ классом нарочно: это самое опасное
// место инкрементального обновления (перепутанный слот = юнит нарисован не там
// или чужим спрайтом), а живой GL-контекст в тестах не поднять. Здесь нет ни
// одного вызова GL — значит логику можно прогнать целиком.
//
// Модель: за юнитом закреплён слот. Удаление — SWAP-REMOVE: на место ушедшего
// переезжает ПОСЛЕДНИЙ, поэтому занятые слоты всегда идут подряд [0, size) и
// счётчик инстансов для отрисовки остаётся точным без «дыр».

/** Что произошло при удалении: какой слот освободился и кто в него переехал. */
export interface SlotRemoval {
  /** Освободившийся слот — именно его надо перезаписать данными переехавшего. */
  slot: number;
  /** Откуда переехали, или -1 если удаляли последний (копировать нечего). */
  movedFrom: number;
  /** id переехавшего юнита, или -1. */
  movedId: number;
}

export class SlotTable {
  private slotOf = new Map<number, number>();
  private idAt: number[] = [];
  private count = 0;

  /** Сколько слотов занято (= сколько инстансов рисовать). */
  get size(): number {
    return this.count;
  }

  slot(id: number): number | undefined {
    return this.slotOf.get(id);
  }

  idOfSlot(slot: number): number {
    return this.idAt[slot] ?? -1;
  }

  /** Слот юнита; заводит новый в конце, если его ещё не было. */
  add(id: number): number {
    const existing = this.slotOf.get(id);
    if (existing !== undefined) return existing;
    const slot = this.count;
    this.slotOf.set(id, slot);
    this.idAt[slot] = id;
    this.count = slot + 1;
    return slot;
  }

  /**
   * Убрать юнита. null, если его и не было.
   * ⚠️ Вызывающий ОБЯЗАН скопировать данные из movedFrom в slot, когда
   * movedFrom >= 0 — иначе на экране останется копия удалённого юнита.
   */
  remove(id: number): SlotRemoval | null {
    const slot = this.slotOf.get(id);
    if (slot === undefined) return null;
    this.slotOf.delete(id);
    const last = this.count - 1;
    this.count = last;
    if (slot === last) return { slot, movedFrom: -1, movedId: -1 };
    const movedId = this.idAt[last];
    this.idAt[slot] = movedId;
    this.slotOf.set(movedId, slot);
    return { slot, movedFrom: last, movedId };
  }

  clear(): void {
    this.slotOf.clear();
    this.idAt.length = 0;
    this.count = 0;
  }

  /**
   * Инвариант для тестов: слоты занимают ровно [0, size), каждый id стоит в
   * своём слоте, обратная таблица согласована. Возвращает описание поломки
   * или null.
   */
  checkInvariant(): string | null {
    if (this.slotOf.size !== this.count) {
      return `id в таблице ${this.slotOf.size}, а занято слотов ${this.count}`;
    }
    const seen = new Set<number>();
    for (const [id, slot] of this.slotOf) {
      if (slot < 0 || slot >= this.count) return `id ${id} в слоте ${slot} вне [0,${this.count})`;
      if (seen.has(slot)) return `слот ${slot} занят дважды`;
      seen.add(slot);
      if (this.idAt[slot] !== id) {
        return `обратная таблица врёт: слот ${slot} → ${this.idAt[slot]}, ожидался ${id}`;
      }
    }
    return null;
  }
}
