import {
  createMatcher,
  FailOpenPrivilegeChecker,
  PrivilegeCheckerImpl,
} from "../src/server/Privilege";

const bannedWords = [
  "hitler",
  "adolf",
  "nazi",
  "jew",
  "auschwitz",
  "whitepower",
  "heil",
  "nigger",
  "nigga",
  "chink",
  "spic",
  "kike",
  "faggot",
  "retard",
  "chair", // Test word to verify custom banned words work
];

const matcher = createMatcher(bannedWords);

// Create a minimal PrivilegeCheckerImpl for testing censor
const mockCosmetics = { patterns: {}, colorPalettes: {}, flags: {} };
const mockDecoder = () => new Uint8Array();
const checker = new PrivilegeCheckerImpl(
  mockCosmetics,
  mockDecoder,
  bannedWords,
);
const emptyChecker = new PrivilegeCheckerImpl(mockCosmetics, mockDecoder, []);

const flagCosmetics = {
  patterns: {},
  colorPalettes: {},
  flags: {
    cool_flag: {
      type: "flag" as const,
      name: "cool_flag",
      url: "https://example.com/cool.png",
      affiliateCode: null,
      product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "common",
    },
  },
};
const flagChecker = new PrivilegeCheckerImpl(
  flagCosmetics,
  mockDecoder,
  bannedWords,
);

const skinCosmetics = {
  patterns: {},
  colorPalettes: {},
  flags: {},
  skins: {
    mountain: {
      name: "mountain",
      url: "https://example.com/mountain.png",
      affiliateCode: null,
      product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "common",
    },
    forest: {
      name: "forest",
      url: "https://example.com/forest.png",
      affiliateCode: null,
      product: null,
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "rare",
    },
  },
};
const skinChecker = new PrivilegeCheckerImpl(
  skinCosmetics,
  mockDecoder,
  bannedWords,
);

describe("UsernameCensor", () => {
  describe("isProfane (via matcher.hasMatch)", () => {
    test("detects exact banned words", () => {
      expect(matcher.hasMatch("hitler")).toBe(true);
      expect(matcher.hasMatch("nazi")).toBe(true);
      expect(matcher.hasMatch("auschwitz")).toBe(true);
      expect(matcher.hasMatch("nigger")).toBe(true);
      expect(matcher.hasMatch("nigga")).toBe(true);
      expect(matcher.hasMatch("chink")).toBe(true);
      expect(matcher.hasMatch("spic")).toBe(true);
      expect(matcher.hasMatch("kike")).toBe(true);
      expect(matcher.hasMatch("faggot")).toBe(true);
      expect(matcher.hasMatch("retard")).toBe(true);
    });

    test("detects banned words case-insensitively", () => {
      expect(matcher.hasMatch("Hitler")).toBe(true);
      expect(matcher.hasMatch("NAZI")).toBe(true);
      expect(matcher.hasMatch("Adolf")).toBe(true);
      expect(matcher.hasMatch("NIGGER")).toBe(true);
      expect(matcher.hasMatch("Nigga")).toBe(true);
      expect(matcher.hasMatch("FAGGOT")).toBe(true);
      expect(matcher.hasMatch("Retard")).toBe(true);
    });

    test("detects banned words with leet speak", () => {
      expect(matcher.hasMatch("h1tl3r")).toBe(true);
      expect(matcher.hasMatch("4d0lf")).toBe(true);
      expect(matcher.hasMatch("n4z1")).toBe(true);
      expect(matcher.hasMatch("n1gg3r")).toBe(true);
      expect(matcher.hasMatch("f4gg0t")).toBe(true);
      expect(matcher.hasMatch("r3t4rd")).toBe(true);
    });

    test("detects banned words with duplicated characters", () => {
      expect(matcher.hasMatch("hiiitler")).toBe(true);
      expect(matcher.hasMatch("naazzii")).toBe(true);
      expect(matcher.hasMatch("niiiigger")).toBe(true);
      expect(matcher.hasMatch("faaggot")).toBe(true);
    });

    test("detects banned words with accented/confusable characters", () => {
      expect(matcher.hasMatch("Adölf")).toBe(true);
      expect(matcher.hasMatch("nïgger")).toBe(true);
    });

    test("detects banned words as substrings", () => {
      expect(matcher.hasMatch("xhitlerx")).toBe(true);
      expect(matcher.hasMatch("IloveNazi")).toBe(true);
      // Regression: slur + suffix / prefix must be caught
      expect(matcher.hasMatch("niggertesting")).toBe(true);
      expect(matcher.hasMatch("testingnigger")).toBe(true);
      expect(matcher.hasMatch("xnazix")).toBe(true);
      expect(matcher.hasMatch("faggotry")).toBe(true);
      expect(matcher.hasMatch("retarded")).toBe(true);
      expect(matcher.hasMatch("MyChairName")).toBe(true);
    });

    test("detects banned words with non-alphabetic characters mixed in", () => {
      expect(matcher.hasMatch("n.i.g.g.e.r")).toBe(true);
      expect(matcher.hasMatch("hi_tler")).toBe(true);
    });

    test("allows clean usernames", () => {
      expect(matcher.hasMatch("CoolPlayer")).toBe(false);
      expect(matcher.hasMatch("GameMaster")).toBe(false);
      expect(matcher.hasMatch("xXx_Sniper_xXx")).toBe(false);
      expect(matcher.hasMatch("ProGamer123")).toBe(false);
      expect(matcher.hasMatch("NightOwl")).toBe(false);
      expect(matcher.hasMatch("DragonSlayer")).toBe(false);
    });

    test("does not false-positive on words containing banned substrings legitimately", () => {
      // "snigger" is whitelisted in englishDataset
      expect(matcher.hasMatch("snigger")).toBe(false);
    });

    test("catches kkk as substring", () => {
      expect(matcher.hasMatch("kkk")).toBe(true);
      expect(matcher.hasMatch("KKK")).toBe(true);
      expect(matcher.hasMatch("kkklover")).toBe(true);
      expect(matcher.hasMatch("ilovekkkboys")).toBe(true);
    });

    test("catches slurs separated by periods (bypass attempt)", () => {
      expect(matcher.hasMatch("n.i.g.g.e.r")).toBe(true);
      expect(matcher.hasMatch("N.I.G.G.E.R")).toBe(true);
      expect(matcher.hasMatch("n.i.g.g.a")).toBe(true);
      expect(matcher.hasMatch("h.i.t.l.e.r")).toBe(true);
      expect(matcher.hasMatch("hello n.i.g.g.e.r world")).toBe(true);
    });

    test("censor passes period-separated slur usernames through (terron: no shadow-name substitution)", () => {
      // The matcher still detects the bypass (see test above); the terron fork
      // deliberately does NOT rewrite usernames in censor().
      const result = checker.censor("n.i.g.g.e.r", null);
      expect(result.username).toBe("n.i.g.g.e.r");
    });
  });

  // terron: по политике проекта censor() ники НЕ подменяет (позывной идёт как
  // есть), а клан-тег только нормализует в верхний регистр. Профанити-матчер
  // (createMatcher) остаётся рабочим и проверяется выше; ownership клан-тегов
  // проверяется отдельно в resolveClanTag.
  describe("censor", () => {
    test("returns clean usernames unchanged", () => {
      expect(checker.censor("CoolPlayer", null).username).toBe("CoolPlayer");
      expect(checker.censor("GameMaster", null).username).toBe("GameMaster");
    });

    test("passes profane usernames through unchanged (terron policy)", () => {
      expect(checker.censor("hitler", null).username).toBe("hitler");
    });

    test("passes leet speak profane usernames through unchanged", () => {
      expect(checker.censor("h1tl3r", null).username).toBe("h1tl3r");
    });

    test("keeps clan tag when username is profane", () => {
      const result = checker.censor("hitler", "COOL");
      expect(result.clanTag).toBe("COOL");
      expect(result.username).toBe("hitler");
    });

    describe("clan tag normalization", () => {
      test("keeps profane clan tag as-is (no profanity filtering in censor)", () => {
        expect(checker.censor("CoolPlayer", "NAZI").clanTag).toBe("NAZI");
        expect(checker.censor("CoolPlayer", "NIG").clanTag).toBe("NIG");
        expect(checker.censor("CoolPlayer", "N4Z1").clanTag).toBe("N4Z1");
        expect(checker.censor("CoolPlayer", "KKK").clanTag).toBe("KKK");
      });

      test("uppercases the clan tag", () => {
        expect(checker.censor("Player", "cool").clanTag).toBe("COOL");
        expect(checker.censor("Player", "ss").clanTag).toBe("SS");
        expect(checker.censor("Player", "CLaN").clanTag).toBe("CLAN");
      });

      test("keeps null clan tag as null", () => {
        expect(checker.censor("Player", null).clanTag).toBeNull();
      });

      test("keeps clean clan tag when username is clean", () => {
        expect(checker.censor("Player", "COOL").clanTag).toBe("COOL");
        expect(checker.censor("Player", "PRO").clanTag).toBe("PRO");
      });

      test("keeps both clan tag and username when both are profane", () => {
        const result = checker.censor("hitler", "NAZI");
        expect(result.clanTag).toBe("NAZI");
        expect(result.username).toBe("hitler");
      });

      test("keeps clan+name parts that combine into a slur (no combined check)", () => {
        const result = checker.censor("LER", "HIT");
        expect(result.username).toBe("LER");
        expect(result.clanTag).toBe("HIT");
      });
    });

    test("is deterministic for same input", () => {
      const a = checker.censor("hitler", null);
      const b = checker.censor("hitler", null);
      expect(a.username).toBe(b.username);
    });

    test("handles username with no clan tag", () => {
      expect(checker.censor("NormalPlayer", null).username).toBe(
        "NormalPlayer",
      );
    });

    test("empty banned words list also passes usernames through", () => {
      expect(emptyChecker.censor("CoolPlayer", null).username).toBe(
        "CoolPlayer",
      );
      expect(emptyChecker.censor("fuck", null).username).toBe("fuck");
    });
  });
});

describe("Flag validation in isAllowed", () => {
  test("allows valid country flag and resolves to SVG path", () => {
    const result = flagChecker.isAllowed([], { flag: "country:us" });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBe("/flags/us.svg");
    }
  });

  test("rejects invalid country code", () => {
    const result = flagChecker.isAllowed([], { flag: "country:zzzz" });
    expect(result.type).toBe("forbidden");
  });

  test("rejects flag with no prefix", () => {
    const result = flagChecker.isAllowed([], { flag: "us" });
    expect(result.type).toBe("forbidden");
  });

  test("allows cosmetic flag when user has wildcard flare", () => {
    const result = flagChecker.isAllowed(["flag:*"], {
      flag: "flag:cool_flag",
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBe("https://example.com/cool.png");
    }
  });

  test("allows cosmetic flag when user has specific flare", () => {
    const result = flagChecker.isAllowed(["flag:cool_flag"], {
      flag: "flag:cool_flag",
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBe("https://example.com/cool.png");
    }
  });

  test("rejects cosmetic flag when user lacks flare", () => {
    const result = flagChecker.isAllowed([], { flag: "flag:cool_flag" });
    expect(result.type).toBe("forbidden");
  });

  test("rejects cosmetic flag that does not exist", () => {
    const result = flagChecker.isAllowed(["flag:*"], {
      flag: "flag:nonexistent",
    });
    expect(result.type).toBe("forbidden");
  });

  test("allows no flag", () => {
    const result = flagChecker.isAllowed([], {});
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBeUndefined();
    }
  });
});

describe("Skin validation", () => {
  describe("isSkinAllowed (direct)", () => {
    test("returns skin when user has wildcard flare", () => {
      const result = skinChecker.isSkinAllowed(["skin:*"], "mountain");
      expect(result).toEqual({
        name: "mountain",
        url: "https://example.com/mountain.png",
      });
    });

    test("returns skin when user has exact-match flare", () => {
      const result = skinChecker.isSkinAllowed(["skin:mountain"], "mountain");
      expect(result).toEqual({
        name: "mountain",
        url: "https://example.com/mountain.png",
      });
    });

    test("ignores unrelated flares", () => {
      expect(() =>
        skinChecker.isSkinAllowed(
          ["skin:forest", "pattern:*", "flag:*"],
          "mountain",
        ),
      ).toThrow(/No flares for skin mountain/);
    });

    test("throws when user has no skin flares", () => {
      expect(() => skinChecker.isSkinAllowed([], "mountain")).toThrow(
        /No flares for skin mountain/,
      );
    });

    test("throws when skin does not exist in cosmetics", () => {
      expect(() =>
        skinChecker.isSkinAllowed(["skin:*"], "nonexistent"),
      ).toThrow(/Skin nonexistent not found/);
    });

    test("throws when skin does not exist even with exact-match flare", () => {
      // Forged refs.skinName must not bypass the existence check.
      expect(() =>
        skinChecker.isSkinAllowed(["skin:nonexistent"], "nonexistent"),
      ).toThrow(/Skin nonexistent not found/);
    });

    test("throws when checker has no skins map at all", () => {
      // checker is constructed with mockCosmetics (no skins key).
      expect(() => checker.isSkinAllowed(["skin:*"], "anything")).toThrow(
        /Skin anything not found/,
      );
    });
  });

  describe("isAllowed integration", () => {
    test("allows valid skin with wildcard flare", () => {
      const result = skinChecker.isAllowed(["skin:*"], {
        skinName: "mountain",
      });
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.skin).toEqual({
          name: "mountain",
          url: "https://example.com/mountain.png",
        });
      }
    });

    test("allows valid skin with exact-match flare", () => {
      const result = skinChecker.isAllowed(["skin:forest"], {
        skinName: "forest",
      });
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.skin).toEqual({
          name: "forest",
          url: "https://example.com/forest.png",
        });
      }
    });

    test("rejects skin when user lacks flare", () => {
      const result = skinChecker.isAllowed([], { skinName: "mountain" });
      expect(result.type).toBe("forbidden");
      if (result.type === "forbidden") {
        expect(result.reason).toMatch(/invalid skin/);
      }
    });

    test("rejects skin when flare is for a different skin", () => {
      const result = skinChecker.isAllowed(["skin:forest"], {
        skinName: "mountain",
      });
      expect(result.type).toBe("forbidden");
    });

    test("rejects nonexistent skin", () => {
      const result = skinChecker.isAllowed(["skin:*"], {
        skinName: "ghost",
      });
      expect(result.type).toBe("forbidden");
      if (result.type === "forbidden") {
        expect(result.reason).toMatch(/Skin ghost not found/);
      }
    });

    test("no skin in refs leaves cosmetics.skin undefined", () => {
      const result = skinChecker.isAllowed(["skin:*"], {});
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.skin).toBeUndefined();
      }
    });

    test("invalid skin short-circuits and does not return other cosmetics", () => {
      // pattern is valid (no pattern requested), color is valid, skin is invalid —
      // the whole result must be forbidden, with no partial cosmetics leaking out.
      const result = skinChecker.isAllowed(["color:red"], {
        color: "red",
        skinName: "mountain",
      });
      expect(result.type).toBe("forbidden");
    });
  });
});

describe("PrivilegeCheckerImpl#resolveClanTag", () => {
  // Reserved tags are stored uppercase, exactly as PrivilegeRefresher loads them.
  const makeChecker = (reservedTags: string[]) =>
    new PrivilegeCheckerImpl(
      mockCosmetics,
      mockDecoder,
      bannedWords,
      new Set(reservedTags),
    );

  it("passes a null tag through unchanged", () => {
    const result = makeChecker(["ABC"]).resolveClanTag(null, []);
    expect(result).toEqual({ tag: null, dropped: false });
  });

  it("accepts a member's tag without consulting the reserved set (case-insensitive)", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("ABC", ["abc"]);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("drops a reserved tag the player does not belong to (impersonation)", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("ABC", ["other"]);
    expect(result).toEqual({ tag: null, dropped: true });
  });

  it("keeps a fictional tag matching no reserved clan", () => {
    const result = makeChecker(["OTHER"]).resolveClanTag("ABC", []);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("matches the reserved set case-insensitively", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("abc", ["other"]);
    expect(result).toEqual({ tag: null, dropped: true });
  });

  it("treats anonymous users as members of no clans", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("ABC", []);
    expect(result).toEqual({ tag: null, dropped: true });
  });
});

describe("FailOpenPrivilegeChecker#resolveClanTag", () => {
  const checker = new FailOpenPrivilegeChecker();

  it("passes a null tag through unchanged", () => {
    const result = checker.resolveClanTag(null, []);
    expect(result).toEqual({ tag: null, dropped: false });
  });

  it("keeps a member's tag (known from owned tags, no lookup needed)", () => {
    const result = checker.resolveClanTag("ABC", ["abc"]);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  // terron: fail-OPEN — пока реестр кланов недоступен (null), теги НЕ
  // резервируются; дропается только конкретно зарегистрированный чужой тег.
  it("keeps a non-member's tag fail-open (no reserved set while infra is down)", () => {
    const result = checker.resolveClanTag("ABC", ["other"]);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("keeps an anonymous user's tag fail-open", () => {
    const result = checker.resolveClanTag("ABC", []);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });
});

// terron (TZ-skin-capitals.md + фикс рассинхрона санитайзеров 24.08):
// customSkin — svg+xml режется (как в platform-api), имя столицы валидируется.
describe("customSkin sanitization", () => {
  const base = { mode: 2, dim: 0.9, tileTiles: 8 };
  const png = "data:image/png;base64,AAAA";

  it("rejects svg+xml data urls (XSS class, parity with platform-api)", () => {
    const r = checker.isAllowed([], {
      customSkin: { ...base, url: "data:image/svg+xml;base64,AAAA" },
    });
    expect(r.type).toBe("allowed");
    if (r.type === "allowed") expect(r.cosmetics.customSkin).toBeUndefined();
  });

  it("rejects oversized urls", () => {
    const r = checker.isAllowed([], {
      customSkin: { ...base, url: "data:image/png;base64," + "A".repeat(400_001) },
    });
    if (r.type === "allowed") expect(r.cosmetics.customSkin).toBeUndefined();
  });

  it("passes a valid capitalName through", () => {
    const r = checker.isAllowed([], {
      customSkin: { ...base, url: png, capitalName: "Хуюмба" },
    });
    expect(r.type).toBe("allowed");
    if (r.type === "allowed")
      expect(r.cosmetics.customSkin?.capitalName).toBe("Хуюмба");
  });

  it("passes a valid falloutSkin and clamps garbage away", () => {
    const ok = checker.isAllowed([], {
      customSkin: { ...base, url: png, falloutSkin: 7 },
    });
    if (ok.type === "allowed")
      expect(ok.cosmetics.customSkin?.falloutSkin).toBe(7);

    for (const bad of [0, 11, -3, 2.5 as number, NaN]) {
      const r = checker.isAllowed([], {
        customSkin: { ...base, url: png, falloutSkin: bad },
      });
      if (r.type === "allowed") {
        expect(r.cosmetics.customSkin).toBeDefined();
        // 2.5 округляется до 3 (валидный узор), остальное отбрасывается
        const got = r.cosmetics.customSkin?.falloutSkin;
        expect(got === undefined || (got >= 1 && got <= 10)).toBe(true);
      }
    }
  });

  it("drops a garbage capitalName but keeps the skin", () => {
    for (const bad of ["ab", "x".repeat(28), "<script>alert(1)</script>", "   "]) {
      const r = checker.isAllowed([], {
        customSkin: { ...base, url: png, capitalName: bad },
      });
      expect(r.type).toBe("allowed");
      if (r.type === "allowed") {
        expect(r.cosmetics.customSkin).toBeDefined();
        expect(r.cosmetics.customSkin?.capitalName).toBeUndefined();
      }
    }
  });
});
