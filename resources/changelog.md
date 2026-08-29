# Список изменений TERRON

## 20–22 июля 2026 — Спидран, скорость и починки

- **Топ спидрана — только базовый конфиг**: настройки лобби теперь проверяются на сервере, забеги с читами и подкрученными ботами в рейтинг не идут.
- В рейтинге появился раздел **«Мои исключённые матчи»** — видно, почему конкретная победа не попала в топ.
- **Лобби из рейтинга** открывается с зафиксированными базовыми настройками (менять можно только сложность) — забег точно зачтётся.
- **Продолжение офлайн-игр**: незаконченный одиночный матч переживает перезагрузку страницы, в создании игры есть список «Продолжить незаконченную».
- Быстрее старт: предкомпиляция шейдеров, мини-превью карт, лечение зависаний и вылетов на входе в матч.
- Починили **рывки скролла** на сайте, сломанные превью карт при смене выбора и кнопку ультимейтов, которая не открывалась без 5M золота.
- Не запускается игра? Открой `terron.io/debug` — страница покажет причину.

## 14 июля 2026 — Вики и большое обновление ультимейтов

- **Вики ультимейтов** (`/wiki/ult`): все способности с точными параметрами и тем, что они открывают.
- **Ультимейты 2.0**: МИРВ теперь запускается со здания **«Ядерный завод»**, а **«Раскол»** — со здания **«МЕДИА»**.
- Пять новых ультимейтов: **Религия**, **Раскол**, **Реваншизм**, **Минирование**, **МЕДИА**.
- **Укрепления** прокачиваются до 3 уровней — бункеры захватывают землю в большем радиусе.
- OG-превью и SEO для страниц вики; внутренний рефакторинг движка ультимейтов.

## 11–13 июля 2026 — Туман войны и «Небо наше»

- Новый режим лобби **«Туман войны»**: видно только свою и союзную территорию плюс кольцо вокруг неё и своих юнитов.
- Ультимейт **«Небо наше»** (антиспутник): после 60-секундного телеграфа на минуту накрывает всех, кроме тебя, туманом войны.
- **Чат в лобби** и видимый отсчёт до старта, который хост может отменить.
- Фиксы: залипший Shift (не давал строить), потеря WebGL-контекста (белый экран на части телефонов).

## 10 июля 2026 — Ультимейты для всех

- **Ультимейты** вышли для всех игроков: одна мощная способность на матч вместо слота МИРВ.
- **Минирование**: половина вражеского морского десанта гибнет на минах при высадке.
- **Пропаганда** (`/propaganda`): скриншоты матчей, альбом и пресскит.
- Спавн **«флагом»** — прямоугольная стартовая зона, под скин.

## 6–7 июля 2026 — Авиация и первые ультимейты

- **Авиация**: аэропорты, торговые самолёты, воздушный десант и дроны-камикадзе.
- Первые ультимейты: **Мин правды**, **Укрепления**, **Центробанк**, **Авиаштаб**, **Танковый завод**.
- **МИРВ против ПВО**: готовое вражеское ПВО прикрывает свой радиус от боеголовок.
- Аналитика трафика и рейтинг тестеров.

## 3–5 июля 2026 — Оптимизация и стабильность

- Крупный пакет производительности: быстрее старт матча, музыка больше не мешает загрузке карты, сжатие игрового трафика (−60–80%), плавнее рендер, меньше вылетов.
- Матчи **переживают перезапуск сервера**: при обрыве клиент сам догоняет пропущенные ходы.
- **HTTP/3**, лёгкие реплеи, −9 МБ ассетов, ускорение базы данных.
- `/stats`: партии за 24 часа; у спидрана — кнопка «Смотреть» (реплей лучшего забега).

## 20 июня 2026 — Лобби и локализация

- **Публичные лобби** на главной: создай — и любой зайдёт. Приватные по ссылке.
- Новое создание игры: **оффлайн / приватно / публично** — выбираешь в настройках лобби, на лету. Старт с одним игроком, звук при входе.
- Игровые панели на **тёмном стекле** — карта видна лучше.
- **Английская локализация** интерфейса.
- Страница удаления аккаунта + соглашение и политика на двух языках.

## 19 июня 2026 — Приложения и стабильность

- Старт **мобильной версии**: Android (Capacitor) + автосборка; iOS — на следующей неделе.
- Реферальная **воронка** в досье и анти-фарм наград.
- Переключатель окружения prod/dev, фиксы iOS-клавиатуры и ввода ника.

## 16 июня 2026 — Рефералы и кастомные скины

- **Реферальная система**: инвайт-ссылки, награды за друзей, лидерборд приглашений.
- **Кастомные скины** — загружай свои, любой формат.
- Баланс цен в магазине.

## 15 июня 2026 — Прогресс

- **Достижения** и **звания**, которые носишь в досье.
- **Ежедневные задачи** с наградами.
- Внутриигровая экономика (ЛТС/ПТС) и магазин скинов.

## 14 июня 2026 — Чат и рейтинг

- Чат и игровые события — в **единой ленте**. Жмёшь Enter — пишешь.
- Лента читаемее: компактные сервисные сообщения с иконками, тогглы категорий.
- **ФФА ПВП рейтинг** и таблицы лидеров: Рейтинг / Игроки / PvP / PvE.

## 12–13 июня 2026 — Скины территорий

- **Скины территории**: тайлинг, растяжка, статика.

## 9–10 июня 2026 — Запуск

- Новый интерфейс в стиле **«штабной карты»**, русские шрифты.

<!--EN-->

# TERRON Changelog

## July 20–22, 2026 — Speedrun, speed & fixes

- **Speedrun leaderboard is standard-config only**: lobby settings are now validated on the server, so runs with cheats or tweaked bot counts never reach the top.
- The rating page gained a **"My excluded matches"** section — you can see exactly why a win didn't make the leaderboard.
- **Lobbies created from the rating page** open with the standard settings locked (only difficulty stays editable), so the run is guaranteed to count.
- **Resume offline games**: an unfinished singleplayer match survives a page reload, and the create-game screen lists unfinished ones.
- Faster start: shader pre-compilation, small map previews, and fixes for freezes and crashes when entering a match.
- Fixed **scroll stutter** on the site, broken map previews when switching maps, and the ultimates button that wouldn't open below 5M gold.
- Game won't start? Open `terron.io/debug` — it tells you why.

## July 14, 2026 — Wiki & a big ultimates update

- An **ultimates wiki** (`/wiki/ult`): every ability with exact stats and what it unlocks.
- **Ultimates 2.0**: MIRV now launches from the **Nuclear Factory** building, and **Split** from the **Media** building.
- Five new ultimates: **Religion**, **Split**, **Revanchism**, **Mining**, **Media**.
- **Fortifications** upgrade to 3 levels — bunkers capture land in a wider radius.
- OG previews and SEO for the wiki pages; an internal ultimates-engine refactor.

## July 11–13, 2026 — Fog of war & "Our Sky"

- A new **"Fog of war"** lobby mode: you only see your and allied territory plus a ring around it and your units.
- The **"Our Sky"** ultimate (anti-satellite): after a 60-second telegraph it blankets everyone but you in fog of war for a minute.
- **Lobby chat** and a visible start countdown the host can cancel.
- Fixes: a stuck Shift key (blocked building), WebGL context loss (a white screen on some phones).

## July 10, 2026 — Ultimates for everyone

- **Ultimates** shipped to all players: one powerful ability per match instead of the MIRV slot.
- **Mining**: half of any enemy sea landing dies on the mines.
- **Propaganda** (`/propaganda`): match screenshots, an album and a press kit.
- **"Flag" spawn** — a rectangular starting zone that fits a skin.

## July 6–7, 2026 — Aviation & the first ultimates

- **Aviation**: airports, trade planes, airborne assault and kamikaze drones.
- The first ultimates: **Ministry of Truth**, **Fortifications**, **Central Bank**, **Air Command**, **Tank Factory**.
- **MIRV vs SAM**: a ready enemy SAM shields its own radius from the warheads.
- Traffic analytics and a testers' rating.

## July 3–5, 2026 — Performance & stability

- A big performance pack: faster match start, music no longer blocks map loading, game-traffic compression (−60–80%), smoother rendering, fewer crashes.
- Matches **survive a server restart**: on a drop the client catches up on missed turns.
- **HTTP/3**, lightweight replays, −9 MB of assets, a faster database.
- `/stats`: games in the last 24 hours; speedrun now has a "Watch" button (a replay of the best run).

## June 20, 2026 — Lobbies & localization

- **Public lobbies** on the home page: create one and anyone can join. Private ones stay link-only.
- New game creation: **offline / private / public** — pick it in the lobby settings, on the fly. Start with a single player, plus a join sound.
- In-game panels on **dark glass** — the map is more visible.
- **English localization** of the interface.
- Account-deletion page + bilingual Terms and Privacy Policy.

## June 19, 2026 — Apps & stability

- A **mobile version** kicked off: Android (Capacitor) + auto-build; iOS next week.
- Referral **funnel** on the dossier and reward anti-farming.
- A prod/dev environment switch, iOS keyboard and username-input fixes.

## June 16, 2026 — Referrals & custom skins

- A **referral system**: invite links, rewards for friends, an invites leaderboard.
- **Custom skins** — upload your own, any format.
- Store price balancing.

## June 15, 2026 — Progression

- **Achievements** and **titles** you wear on your dossier.
- **Daily tasks** with rewards.
- In-game economy (LTS/PTS) and a skin store.

## June 14, 2026 — Chat & rating

- Chat and game events in a **single feed**. Press Enter to type.
- A more readable feed: compact service messages with icons, category toggles.
- **FFA PvP rating** and leaderboards: Rating / Players / PvP / PvE.

## June 12–13, 2026 — Territory skins

- **Territory skins**: tiled, stretched, static.

## June 9–10, 2026 — Launch

- A new **"command-map"** interface and Russian fonts.
