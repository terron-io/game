import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { L, translateText } from "./Utils";

// terron: /currency — публичная лор-страница валют. Золото (слиток), ценные
// бумаги (lts), кровавые алмазы (pts). Имена наружу — без кодов ЛТС/ПТС.
const goldIcon = assetUrl("images/GoldCoinIcon.svg");
const bondIcon = assetUrl("images/BondIcon.svg");
const diamondIcon = assetUrl("images/BloodDiamondIcon.svg");

@customElement("currency-page")
export class CurrencyPage extends BaseModal {
  protected routerName = "currency";

  protected modalConfig() {
    return { title: L("Валюты", "Currencies") };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Валюты", "Currencies"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private card(
    icon: string,
    name: string,
    tag: string,
    body: TemplateResult,
  ): TemplateResult {
    return html`<div
      style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:var(--t-sheet);margin-bottom:12px"
    >
      <img
        src=${icon}
        alt=""
        style="width:48px;height:48px;flex:0 0 auto;object-fit:contain;margin-top:2px"
      />
      <div>
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
          <span style="font-weight:800;font-size:17px">${name}</span>
          <span style="font-size:12px;color:var(--t-muted,#888)">${tag}</span>
        </div>
        <div
          style="font-size:14px;line-height:1.6;margin-top:6px;color:var(--t-ink)"
        >
          ${body}
        </div>
      </div>
    </div>`;
  }

  protected renderBody(): TemplateResult {
    const ru = L("ru", "en") === "ru";
    return html`<div class="t-page" style="max-width:680px">
      <p style="color:var(--t-muted,#888);line-height:1.6;margin:0 0 18px">
        ${L(
          "Три валюты держав. У каждой — своя цена и своя история.",
          "Three currencies of nations. Each has its own value — and its own history.",
        )}
      </p>

      ${this.card(
        goldIcon,
        L("Золото", "Gold"),
        L("слитки", "ingots"),
        ru
          ? html`Сколько стоит человек, армия, держава? Во все эпохи ответ один —
            золото. Оно не ржавеет, не гниёт и не врёт. Им платили легионам Рима и
            наёмникам Ренессанса, его взвешивали на весах фараонов и прятали в
            трюмах галеонов. Цари падали, валюты сгорали в кострах инфляции — а
            слиток оставался слитком. В TERRON золото — кровь экономики: его
            добывают, копят и тратят прямо в бою.`
          : html`What is a person, an army, a nation worth? In every age the
            answer was the same — gold. It does not rust, rot, or lie. In TERRON
            gold is the blood of the economy: earned, hoarded and spent right in
            battle.`,
      )}
      ${this.card(
        bondIcon,
        L("Ценные бумаги", "Securities"),
        L("игровая валюта", "soft currency"),
        ru
          ? html`Таскать сундук золота по полю боя — глупо и опасно. Поэтому ещё
            средневековые менялы и ювелиры начали выдавать расписку: «предъявителю
            сего причитается столько-то золота из моих кладовых». Бумага была
            легче, а доверие к подписи — крепче замка. Так из долговых расписок
            родились первые банкноты и облигации: ценность не в самой бумаге, а в
            обещании за ней. Ценные бумаги — мягкая валюта державы, её
            зарабатывают в боях.`
          : html`Hauling a chest of gold across a battlefield is foolish. So
            medieval money-changers and goldsmiths began issuing receipts — and
            from those IOUs the first banknotes and bonds were born: value lies
            not in the paper but in the promise behind it. Securities are the soft
            currency of a nation, earned in battle.`,
      )}
      ${this.card(
        diamondIcon,
        L("Кровавые алмазы", "Blood diamonds"),
        L("премиум-валюта", "premium currency"),
        ru
          ? html`Алмаз — это уголь, переживший ад: миллионы лет давления и жара.
            Самый твёрдый и самый желанный камень на земле. Но у части из них
            дурная слава: «кровавыми» (конфликтными) алмазами называют камни,
            добытые в зонах войн, — ими полевые командиры платили за оружие.
            Красивый блеск, тёмная цена. В TERRON кровавые алмазы — редкая твёрдая
            валюта, за которую дают то, чего не купишь за бумагу.`
          : html`A diamond is coal that survived hell: millions of years of
            pressure and heat — the hardest, most coveted stone on earth. But
            "blood" (conflict) diamonds are those mined in war zones, used by
            warlords to pay for weapons. A beautiful shine, a dark price. In
            TERRON blood diamonds are the rare hard currency that buys what paper
            cannot.`,
      )}

      <!-- сноска: чем ещё валютили -->
      <div
        style="margin-top:24px;padding-top:18px;border-top:1px solid var(--t-border,rgba(0,0,0,.15));font-size:13px;line-height:1.65;color:var(--t-muted,#888)"
      >
        <div
          style="font-weight:800;font-size:14px;color:var(--t-ink);margin-bottom:10px"
        >
          ${L("Чем ещё валютили", "What else served as money")}
        </div>
        <p style="margin:0 0 10px">
          ${ru
            ? html`Деньгами становилось почти что угодно — лишь бы вокруг верили в
              ценность. На острове <b>Яп</b> деньгами были огромные каменные диски
              (до нескольких тонн): их почти не двигали — владельца все знали на
              словах. Один диск утонул при перевозке и всё равно остался «в
              обороте», как запись в общем реестре, — по сути древний аналог
              блокчейна.`
            : html`Almost anything became money as long as people believed in its
              value. On the island of <b>Yap</b>, money was giant stone discs (up
              to several tons): they were rarely moved — everyone simply knew the
              owner. One disc sank during transport and still counted as money,
              like an entry in a shared ledger — essentially an ancient
              blockchain.`}
        </p>
        <p style="margin:0 0 12px">
          ${ru
            ? html`А <b>каури</b> — раковины моллюска с Мальдив — веками были
              деньгами в Африке, Индии, Китае и Юго-Восточной Азии; их возили за
              тысячи километров. В Европе каури находят в раскопках, но там это
              чаще украшения, а не деньги.`
            : html`And <b>cowrie shells</b> from the Maldives were money for
              centuries across Africa, India, China and Southeast Asia, carried
              thousands of kilometres. In Europe cowries turn up in digs too — but
              mostly as ornaments, not coin.`}
        </p>
        <div style="color:var(--t-ink)">
          ${ru
            ? html`В разных культурах разменом служило своё:
                <ul style="margin:8px 0 0;padding-left:18px;line-height:1.8">
                  <li>
                    <b>Ракушки:</b> каури, вампум (раковинные бусы индейцев Сев.
                    Америки).
                  </li>
                  <li>
                    <b>Скот и зерно:</b> коровы (от лат. <i>pecus</i> «скот» —
                    слово <i>pecunia</i>, «деньги»), зерно в Египте, рис.
                  </li>
                  <li>
                    <b>Соль:</b> ценилась так, что от лат. <i>salarium</i> пошло
                    слово <i>salary</i> (жалование).
                  </li>
                  <li><b>Чай:</b> прессованные кирпичи в Тибете и Монголии.</li>
                  <li>
                    <b>Меха:</b> на Руси — куны (от «куница»), соболя, белки.
                  </li>
                  <li><b>Какао-бобы:</b> у ацтеков.</li>
                  <li>
                    <b>Металл до монет:</b> серебро на вес (викинги), браслеты-
                    маниллы и медные кресты (Зап. Африка), железные прутья.
                  </li>
                  <li>
                    <b>Колонии и войны:</b> табак (Виргиния), ром (Карибы),
                    бобровые шкуры (Канада); сигареты — стабильнее денег в лагерях
                    и послевоенной Европе.
                  </li>
                </ul>`
            : html`Different cultures used their own tender:
                <ul style="margin:8px 0 0;padding-left:18px;line-height:1.8">
                  <li>
                    <b>Shells:</b> cowries, wampum (shell beads of Native North
                    Americans).
                  </li>
                  <li>
                    <b>Livestock & grain:</b> cattle (Latin <i>pecus</i>, "cattle"
                    → <i>pecunia</i>, "money"), grain in Egypt, rice.
                  </li>
                  <li>
                    <b>Salt:</b> so valued that Latin <i>salarium</i> gave us
                    "salary".
                  </li>
                  <li><b>Tea:</b> pressed bricks in Tibet and Mongolia.</li>
                  <li>
                    <b>Furs:</b> in old Rus — kuna (from "marten"), sable, squirrel.
                  </li>
                  <li><b>Cocoa beans:</b> among the Aztecs.</li>
                  <li>
                    <b>Pre-coin metal:</b> silver by weight (Vikings), manilla
                    bracelets and copper crosses (West Africa), iron bars.
                  </li>
                  <li>
                    <b>Colonies & wars:</b> tobacco (Virginia), rum (Caribbean),
                    beaver pelts (Canada); cigarettes — steadier than cash in
                    camps and post-war Europe.
                  </li>
                </ul>`}
        </div>
      </div>
    </div>`;
  }
}
