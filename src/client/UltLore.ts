// terron 26.08: ИСТОРИЯ УЛЬТ — вкладка «История» в карточке дерева (/ults) и
// в общей таблице. Решение владельца: «история это допустим дора, для бункеров
// можно албанию использовать». У каждой ульты есть РЕАЛЬНЫЙ прототип; вкладка
// рассказывает про него, а не про игровые цифры (цифры — вкладка «Ульта»).
//
// ⚠️ Ключ = `key` записи ULTIMATE_REGISTRY (он же ключ вики и lang), НЕ UnitType:
// по нему же строится ссылка `/wiki/ult/<key>`, второй таблицы не заводим.
// ⚠️ Тексты живут ЗДЕСЬ, а не в resources/lang/*.json: это контент одной
// страницы (29 записей ×2 языка), а плоские lang-ключи гейт TranslationSystem
// сверяет с использованием — 58 ключей ради одной вкладки только зашумят его.
// ⚠️ У СЕКРЕТНЫХ ульт истории нет и быть не должно: имя такой ульты скрыто
// («????»), а любая историческая подпись его выдаёт. Сторож — UltLore.test.ts.
// Так выпал «Шагающий город» (Archigram, 1964) — лора была написана, но ульта
// секретная, и подпись под вкладкой назвала бы её раньше, чем игрок нашёл код.

import { getCurrentLang } from "./Utils";

export interface LoreText {
  /** Короткая подпись-прототип: «Schwerer Gustav, 1942». */
  about: string;
  /** Сам рассказ, 2–4 предложения. */
  text: string;
}

export interface UltLoreEntry {
  ru: LoreText;
  en: LoreText;
}

export const ULT_LORE: Readonly<Record<string, UltLoreEntry>> = {
  nuclear_factory: {
    ru: {
      about: "Minuteman III, 1970",
      text: "Одна ракета — одна цель, пока в 1970-м на Minuteman III не поставили разделяющуюся головную часть: три блока, каждый со своим прицелом. Оборона, которую считали «ракета к ракете», разом устарела — перехватывать пришлось втрое больше целей, чем стартовало.",
    },
    en: {
      about: "Minuteman III, 1970",
      text: "One missile meant one target — until the 1970 Minuteman III carried a multiple warhead: three independently aimed re-entry vehicles. Defences counted one interceptor per missile, and overnight had to stop three times what was launched.",
    },
  },
  fortifications: {
    ru: {
      about: "Албания, 1967–1986",
      text: "Поссорившись и с Западом, и с СССР, Энвер Ходжа залил страну бетонными куполами: по разным подсчётам от 170 до 750 тысяч бункеров — примерно по одному на четырёх жителей. Вторжения, к которому готовились двадцать лет, не случилось ни разу. Бункеры стоят до сих пор: в них держат скот, хранят вино и открывают кафе.",
    },
    en: {
      about: "Albania, 1967–1986",
      text: "Having fallen out with both the West and the USSR, Enver Hoxha poured the country full of concrete domes — estimates run from 170,000 to 750,000 bunkers, roughly one per four citizens. The invasion they spent twenty years preparing for never came. The bunkers are still there, holding livestock, wine and the odd café.",
    },
  },
  central_bank: {
    ru: {
      about: "Банк Англии, 1694",
      text: "Банк Англии основали не ради экономики, а ради войны с Францией: казна была пуста, и лондонские купцы одолжили короне 1.2 млн фунтов в обмен на право печатать банкноты под этот долг. Так выяснилось, что тот, кто держит деньги страны, влияет на её войны не меньше генералов.",
    },
    en: {
      about: "Bank of England, 1694",
      text: "The Bank of England was founded to fund a war with France, not to run an economy: the treasury was empty, so London merchants lent the crown £1.2 million in exchange for the right to issue notes against that debt. Whoever holds a country's money turned out to shape its wars as much as its generals.",
    },
  },
  air_command: {
    ru: {
      about: "Крит, май 1941",
      text: "Немецкий десант взял Крит без единого корабля — с неба. Победа вышла такой дорогой (значительная часть парашютистов погибла в первые сутки), что крупных высадок немцы больше не устраивали, зато союзники срочно завели собственные воздушно-десантные дивизии.",
    },
    en: {
      about: "Crete, May 1941",
      text: "German paratroopers took Crete without a single ship — straight out of the sky. The win cost so much (a large share of the jumpers died on the first day) that Germany never mounted a big airborne drop again, while the Allies rushed to build airborne divisions of their own.",
    },
  },
  tank_factory: {
    ru: {
      about: "Танкоград, Челябинск, 1941",
      text: "Осенью 1941-го челябинский тракторный слили с эвакуированными ленинградским и харьковским заводами — вышел Танкоград. Оборудование вывозили под бомбёжками и запускали прямо в поле: первые станки давали продукцию под открытым небом, стены и крышу ставили уже вокруг работающего цеха.",
    },
    en: {
      about: "Tankograd, Chelyabinsk, 1941",
      text: "In the autumn of 1941 the Chelyabinsk tractor works absorbed plants evacuated from Leningrad and Kharkov, and became Tankograd. Machinery was hauled out under bombing and restarted in open fields: the first lathes ran under the sky, and the walls went up around a shop floor that was already working.",
    },
  },
  media: {
    ru: {
      about: "Радио вместо армии",
      text: "В холодную войну по обе стороны занавеса вещали чужие голоса — «Свобода», «Голос Америки», Би-би-си. СССР ответил сетью глушилок, и к 1980-м на глушение уходило больше энергии, чем на всё собственное вещание страны. Заглушить слово оказалось дороже, чем его сказать.",
    },
    en: {
      about: "Radio instead of an army",
      text: "Through the Cold War, foreign voices broadcast across the Iron Curtain — Radio Liberty, Voice of America, the BBC. The USSR answered with a jamming network so large that by the 1980s jamming burned more power than all of the country's own broadcasting. Silencing the word cost more than saying it.",
    },
  },
  religion: {
    ru: {
      about: "Аугсбург, 1555",
      text: "Аугсбургский мир закрыл религиозную войну формулой cuius regio, eius religio — «чья власть, того и вера»: подданные принимали исповедание своего князя, а несогласным оставляли право уехать. Границы веры впервые провели по границам владений.",
    },
    en: {
      about: "Augsburg, 1555",
      text: "The Peace of Augsburg ended a religious war with the formula cuius regio, eius religio — whose realm, his religion: subjects took their prince's faith, and those who refused were left the right to leave. For the first time the border of a belief was drawn along the border of an estate.",
    },
  },
  mining: {
    ru: {
      about: "Мессины, 7 июня 1917",
      text: "Под немецкими позициями у Мессин британцы два года рыли тоннели и заложили девятнадцать зарядов — сотни тонн взрывчатки. Утром хребет взлетел на воздух; взрыв, по свидетельствам, слышали в Лондоне. Позицию, которую не могли взять годами, заняли за часы.",
    },
    en: {
      about: "Messines, 7 June 1917",
      text: "Under the German positions at Messines the British dug for two years and packed nineteen mines with hundreds of tonnes of explosive. One morning the ridge went up; the blast was reportedly heard in London. A line that had held for years was taken in hours.",
    },
  },
  revanchism: {
    ru: {
      about: "Франция после 1871",
      text: "Потеряв Эльзас и Лотарингию, Франция сорок лет жила словом revanche: статую Страсбурга на площади Согласия в Париже держали в трауре, а отторгнутые земли печатали на картах особым цветом. Проигранная война оказалась долговечнее выигранной.",
    },
    en: {
      about: "France after 1871",
      text: "Having lost Alsace and Lorraine, France spent forty years on one word — revanche. The statue of Strasbourg on the Place de la Concorde was kept draped in mourning, and the lost provinces were printed on maps in a colour of their own. The defeat outlived the victory that caused it.",
    },
  },
  our_sky: {
    ru: {
      about: "Starfish Prime, 1962 · противоспутниковое оружие",
      text: "Ядерный взрыв на высоте около 400 км в 1962-м вывел из строя треть аппаратов на низких орбитах — включая чужие и свои. Позже сбивать научились точечно: в 1985-м спутник поразили ракетой с истребителя, в 2007-м Китай уничтожил свой аппарат и засорил орбиту обломками на десятилетия.",
    },
    en: {
      about: "Starfish Prime, 1962 · anti-satellite weapons",
      text: "A nuclear detonation some 400 km up in 1962 crippled about a third of everything in low orbit — other people's satellites and its own alike. Later the shot got precise: in 1985 a fighter-launched missile killed a satellite, and in 2007 China destroyed one of its own, littering the orbit with debris for decades.",
    },
  },
  rivers_back: {
    ru: {
      about: "Зёйдерзе · поворот сибирских рек",
      text: "Нидерланды отгородили дамбой морской залив и осушили его — на дне выросли поля и города там, где ходили корабли. В СССР к 1980-м всерьёз считали поворот сибирских рек на юг; проект закрыли в 1986-м, но карту к тому времени уже перекроили Каракумский канал и высыхающий Арал.",
    },
    en: {
      about: "Zuiderzee · reversing Siberian rivers",
      text: "The Netherlands dammed off a sea inlet and drained it — fields and towns now stand on a seabed where ships once sailed. The USSR seriously costed turning Siberian rivers south; the scheme was shelved in 1986, but by then the Karakum Canal and the shrinking Aral Sea had already redrawn the map.",
    },
  },
  submarine_base: {
    ru: {
      about: "Волчьи стаи, 1940–1943",
      text: "Дёниц свёл лодки в «стаи»: одна находит конвой, наводит остальных по радио, бьют ночью из надводного положения. Битву за Атлантику считали не в боях, а в тоннах — и переломили её не корабли, а расшифрованная «Энигма» и самолёты дальнего радиуса, закрывшие «чёрную дыру» посреди океана.",
    },
    en: {
      about: "Wolfpacks, 1940–1943",
      text: "Dönitz gathered his boats into packs: one finds the convoy, radios the rest in, and they strike at night on the surface. The Battle of the Atlantic was counted in tonnage, not battles — and it turned not on warships but on broken Enigma traffic and long-range aircraft that closed the mid-ocean gap.",
    },
  },
  oil_rig: {
    ru: {
      about: "Нефтяные Камни, 1949",
      text: "В Каспии в 1949-м поставили первую в мире морскую нефтяную платформу — и она разрослась в город на сваях: улицы, общежития, хлебозавод, парк и сотни километров эстакад прямо над водой. Часть его работает до сих пор, часть ушла в море.",
    },
    en: {
      about: "Neft Daşları, 1949",
      text: "The world's first offshore oil platform went up in the Caspian in 1949 — and grew into a town on stilts: streets, dormitories, a bakery, a park and hundreds of kilometres of trestle roads over open water. Part of it still works; part of it has gone under.",
    },
  },
  closed_country: {
    ru: {
      about: "Сакоку, Япония 1639–1853",
      text: "Больше двух веков Япония запрещала подданным покидать страну, а чужакам — входить: вся торговля с Западом шла через один искусственный островок в гавани Нагасаки. Кончилось это в 1853-м, когда на рейд вошла американская эскадра и вежливо предложила открыться.",
    },
    en: {
      about: "Sakoku, Japan 1639–1853",
      text: "For over two centuries Japan forbade its people to leave and outsiders to enter: all Western trade passed through a single artificial islet in Nagasaki harbour. It ended in 1853, when an American squadron anchored offshore and politely suggested opening up.",
    },
  },
  piracy: {
    ru: {
      about: "Каперский патент",
      text: "Государства не столько боролись с пиратами, сколько нанимали их: каперский патент превращал грабёж чужих купцов в законную службу. Фрэнсиса Дрейка испанцы считали разбойником, а королева Елизавета посвятила его в рыцари прямо на палубе корабля, набитого испанским серебром.",
    },
    en: {
      about: "The letter of marque",
      text: "States fought pirates rather less than they hired them: a letter of marque turned robbing enemy merchants into lawful service. Spain called Francis Drake a bandit; Elizabeth I knighted him on the deck of a ship loaded with Spanish silver.",
    },
  },
  pride: {
    ru: {
      about: "Зимняя война, 1939–1940",
      text: "Финляндия против СССР: соотношение сил было безнадёжным, а страна продержалась 105 дней и сохранила независимость. Слабейший дерётся иначе — знает местность, считает каждый патрон и бьёт туда, где его не ждут.",
    },
    en: {
      about: "The Winter War, 1939–1940",
      text: "Finland against the USSR: the balance of forces was hopeless, yet the country held for 105 days and kept its independence. The weaker side fights differently — it knows the ground, counts every round, and strikes where nobody is looking.",
    },
  },
  olympics: {
    ru: {
      about: "Экехейрия, Олимпия",
      text: "На время игр в Древней Греции объявляли экехейрию — священное перемирие: войска не входили в Элиду, а атлетам и зрителям гарантировали безопасный проход через воюющие полисы. Войны не отменяли — их ставили на паузу.",
    },
    en: {
      about: "Ekecheiria, Olympia",
      text: "For the duration of the ancient Games a sacred truce, the ekecheiria, was proclaimed: armies stayed out of Elis, and athletes and spectators were guaranteed safe passage through warring city-states. The wars were not called off — they were paused.",
    },
  },
  fanaticism: {
    ru: {
      about: "Аламут, XI–XIII вв.",
      text: "Низариты держали горные крепости во главе с Аламутом и вели войну без армии: одиночка месяцами подбирался к правителю и бил кинжалом, зная, что живым не уйдёт. Государства с несравнимо большими силами предпочитали с ними договариваться.",
    },
    en: {
      about: "Alamut, 11th–13th centuries",
      text: "The Nizaris held mountain fortresses headed by Alamut and waged war without an army: a single man would spend months getting close to a ruler, then strike with a dagger knowing he would not walk away. States with vastly greater forces preferred to negotiate.",
    },
  },
  victory_banner: {
    ru: {
      about: "Рейхстаг, 1945",
      text: "Флаг над Рейхстагом водружали не один раз: штурмовые группы срывались, знамёна сбивали огнём. Знаменитый снимок сделан уже после боя, постановкой, — но именно он стал точкой в войне, потому что смысл был не в ткани, а в том, чьё это здание.",
    },
    en: {
      about: "The Reichstag, 1945",
      text: "The flag over the Reichstag went up more than once: assault parties were driven back and banners were shot down. The famous photograph was staged after the fighting — and still it closed the war, because the point was never the cloth but whose building it stood on.",
    },
  },
  peace_palace: {
    ru: {
      about: "Дворец наций, Женева",
      text: "Дворец наций строили как дом вечного мира: Лига Наций въехала в 1936-м, а через три года началась война, которую Лига не смогла остановить. Здание пережило её и работает до сих пор — институты мира долговечнее того мира, который они сторожат.",
    },
    en: {
      about: "Palace of Nations, Geneva",
      text: "The Palace of Nations was built as a house of permanent peace: the League of Nations moved in in 1936, and three years later came the war it could not stop. The building outlived it and is still in use — institutions of peace outlast the peace they are meant to guard.",
    },
  },
  greens: {
    ru: {
      about: "Rainbow Warrior, 1985",
      text: "Судно «Гринпис» шло мешать французским ядерным испытаниям в Тихом океане и было взорвано агентами спецслужбы прямо в порту Окленда; погиб фотограф. Скандал обошёлся Франции дороже самих испытаний: протест, который пытались утопить, услышали везде.",
    },
    en: {
      about: "Rainbow Warrior, 1985",
      text: "The Greenpeace ship was sailing to disrupt French nuclear tests in the Pacific when intelligence agents sank it at its berth in Auckland; a photographer was killed. The scandal cost France more than the tests: the protest they tried to drown was heard everywhere.",
    },
  },
  nuclear_plant: {
    ru: {
      about: "Обнинск 1954 · Чернобыль 1986",
      text: "Первая в мире АЭС дала ток в Обнинске в 1954-м — атом наконец работал, а не взрывался. Через тридцать два года Чернобыль показал вторую половину сделки: реактор кормит страну, пока цел, а перестав быть целым, забирает область целиком и надолго.",
    },
    en: {
      about: "Obninsk 1954 · Chernobyl 1986",
      text: "The world's first nuclear power station fed the grid at Obninsk in 1954 — the atom finally working instead of exploding. Thirty-two years later Chernobyl showed the other half of the bargain: a reactor feeds a country while it holds, and when it stops holding it takes a whole region, for a long time.",
    },
  },
  fuel: {
    ru: {
      about: "Нефтяное эмбарго, 1973",
      text: "Осенью 1973-го арабские экспортёры срезали поставки — за несколько месяцев нефть подорожала в разы, в Европе вводили воскресенья без автомобилей. Оружием оказалась не армия, а вентиль: у кого топливо, тот задаёт всем остальным темп.",
    },
    en: {
      about: "The oil embargo, 1973",
      text: "In the autumn of 1973 Arab exporters cut supply; within months crude had multiplied in price and European countries were declaring car-free Sundays. The weapon was not an army but a valve: whoever holds the fuel sets everyone else's pace.",
    },
  },
  rail_gun: {
    ru: {
      about: "Schwerer Gustav / «Дора», 1942",
      text: "80-см железнодорожное орудие — самое крупное, когда-либо стрелявшее: снаряд около семи тонн, две сдвоенные колеи под лафет, недели на сборку и обслуга в тысячи человек вместе с охраной и ПВО. Под Севастополем «Дора» сделала несколько десятков выстрелов. Больше её толком применить не смогли: такое оружие побеждает не враг, а собственная логистика.",
    },
    en: {
      about: "Schwerer Gustav / Dora, 1942",
      text: "An 80 cm railway gun — the largest ever fired: a shell of roughly seven tonnes, a double set of twin tracks to carry the mount, weeks to assemble, and a crew that ran into thousands once guards and anti-aircraft units were counted. At Sevastopol Dora fired a few dozen rounds. It was never usefully deployed again: a weapon like that is beaten by its own logistics, not by the enemy.",
    },
  },
  spaceport: {
    ru: {
      about: "Байконур, 1955",
      text: "Площадку выбрали в казахской степи — за пустоту вокруг и за то, что южнее: у экватора вращение Земли само добавляет ракете скорость. Через два года отсюда ушёл «Спутник», ещё через четыре — Гагарин. Космодром меряется не стенами, а тем, до чего с него дотягиваются.",
    },
    en: {
      about: "Baikonur, 1955",
      text: "The site was picked in the Kazakh steppe for the emptiness around it and for being far south: nearer the equator, the Earth's spin hands a rocket free speed. Two years later Sputnik left from there, and four years after that, Gagarin. A spaceport is measured not by its walls but by what it can reach.",
    },
  },
  peaceful_sky: {
    ru: {
      about: "Свердловск, 1 мая 1960",
      text: "Высотный разведчик U-2 считался недосягаемым, пока над Свердловском его не сбили зенитной ракетой — вместе с собственным истребителем, попавшим под тот же залп. Сплошная ПВО не разбирает, чей самолёт в небе: она закрывает небо целиком.",
    },
    en: {
      about: "Sverdlovsk, 1 May 1960",
      text: "The high-altitude U-2 was considered untouchable until a surface-to-air missile brought one down over Sverdlovsk — along with one of the defenders' own fighters caught in the same salvo. Blanket air defence does not ask whose aircraft it is: it closes the whole sky.",
    },
  },
  train_depot: {
    ru: {
      about: "«Рельсовая война», 1943",
      text: "Летом 1943-го партизаны за считанные ночи подорвали десятки тысяч рельсов в немецком тылу: подвоз к фронту встал вернее, чем от бомбёжек. Железная дорога кормит армию — и по ней же к армии приезжает то, чего она не ждала.",
    },
    en: {
      about: "The Rail War, 1943",
      text: "In the summer of 1943 partisans blew tens of thousands of rails behind German lines in a matter of nights: supply to the front stopped more surely than bombing could manage. A railway feeds an army — and delivers, down the same track, whatever the army was not expecting.",
    },
  },
};

/** Историческая справка на языке интерфейса; null — у секретных и новых ульт. */
export function ultLore(key: string): LoreText | null {
  const e = ULT_LORE[key];
  if (e === undefined) return null;
  return getCurrentLang() === "ru" ? e.ru : e.en;
}
