import { describe, expect, it } from "vitest";
import {
  isCoreMismatch,
  shouldWarnNoReload,
} from "../../src/client/CoreVersionCheck";

describe("CoreVersionCheck", () => {
  it("перезагрузился посреди матча — расхождение", () => {
    expect(isCoreMismatch("old", "new")).toBe(true);
    expect(isCoreMismatch("same", "same")).toBe(false);
  });
  it("нет отпечатка у сервера или у бандла — молчим", () => {
    expect(isCoreMismatch(undefined, "new")).toBe(false);
    expect(isCoreMismatch("old", null)).toBe(false);
  });
  it("старая вкладка в матче, а сервер уже обновился — «не перезагружай»", () => {
    expect(shouldWarnNoReload("old", "new", "old")).toBe(true);
    expect(shouldWarnNoReload("old", undefined, "old")).toBe(false);
    // уже перезагрузился — это другой случай (расхождение), не этот
    expect(shouldWarnNoReload("old", "new", "new")).toBe(false);
  });
});
