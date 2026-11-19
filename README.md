# Auth: Google / Facebook / Telegram / Email

Регистрация и вход через Google, Facebook, Telegram, а также по email и паролю
с подтверждением email кодом.

- **Frontend:** React 19, TypeScript (strict), Vite 8, Tailwind CSS v4, React Router 7, axios.
- **Backend:** Node.js 22.18+ (проверено на 24), TypeScript (strict), Express 5,
  встроенный `node:sqlite`, nodemailer, google-auth-library, Redis (опционально).
- **Качество:** 119 тестов бэкенда (`node:test`), 27 тестов фронтенда (Vitest + Testing Library),
  проверка типов `tsc`, oxlint, Prettier, CI в GitHub Actions.

> Бэкенд переписан с Django на Node.js (папка [`backend-node/`](backend-node/)). API, база данных
> и `.env` остались прежними, фронтенд не менялся. Старый Django-бэкенд пока лежит в `backend/`,
> подробности перехода — в разделе [Переход с Django](#переход-с-django).

## Содержание

1. [Возможности](#возможности)
2. [Быстрый старт](#быстрый-старт)
3. [Настройка](#настройка)
4. [Как это устроено](#как-это-устроено)
5. [API](#api)
6. [Безопасность и архитектурные решения](#безопасность-и-архитектурные-решения)
7. [Структура проекта](#структура-проекта)
8. [Тесты и CI](#тесты-и-ci)
9. [Получение ключей провайдеров](#получение-ключей-провайдеров)
10. [Перед продакшеном](#перед-продакшеном)
11. [Переход с Django](#переход-с-django)
12. [Известные упрощения](#известные-упрощения)

## Возможности

| Страница | Что происходит |
|---|---|
| `/signup` | Имя, email, пароль и подтверждение → код на почту (`/verify`) → аккаунт создан → `/login` с подставленным email → вход |
| `/login` | Email и пароль **или** Google / Facebook / Telegram; ссылка «Forgot password?» |
| `/forgot-password` | Email → код на почту (`/verify`) → новый пароль (`/reset-password`) → вход |
| `/telegram` | Вход через бота: кнопка в боте присылает код, код вводится на сайте |
| `/` | Профиль: подключённые способы входа (подключить и отключить), пароль (задать и сменить), выход |

- Соцсети регистрируют при первом входе и логинят при следующих, поэтому кнопки одинаковые
  на обеих страницах (ниже формы, как на большинстве сайтов).
- Кнопки отправки неактивны, пока обязательные поля не заполнены.
- Код можно вставить из буфера обмена: через `Ctrl+V` или кнопку «Paste». Цифры извлекаются
  и из вида `482 913`, и из целого сообщения бота.
- Аккаунты связываются: Google с тем же подтверждённым email попадает в тот же аккаунт.
- Тёмная тема по настройке системы.

## Быстрый старт

Нужен **Node.js 22.18+** (проверено на 24). Python больше не нужен.

```bash
# backend → http://localhost:8000
cd backend-node
npm install
copy .env.example .env      # macOS/Linux: cp
npm run dev                 # таблицы БД создаются при первом запуске

# frontend → http://localhost:5173
cd frontend
npm install
copy .env.example .env
npm run dev
```

Без ключей провайдеров работает регистрация и вход по email. Письма при этом печатаются
в консоль бэкенда:

```
Subject: 281632 is your verification code
...
Your code to finish signing up: 281632
```

Чтобы посмотреть весь интерфейс без SMTP и без ключей провайдеров, включите
[тестовые режимы](#тестовые-режимы-только-при-debugtrue).

## Настройка

Все секреты читаются из `backend-node/.env` и никогда не попадают во фронтенд. Шаблоны лежат
в `backend-node/.env.example` и `frontend/.env.example`. После изменения `.env` перезапустите
`npm run dev`.

### Backend (`backend-node/.env`)

Имена переменных сохранены со времён Django (`DJANGO_*`), поэтому старый `.env` подходит без изменений.

| Переменная | Назначение |
|---|---|
| `DJANGO_SECRET_KEY` | Ключ подписи JWT и хешей кодов. **При переходе с Django оставьте прежнее значение** |
| `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` | Режим отладки и разрешённые значения заголовка `Host` |
| `CORS_ALLOWED_ORIGINS` | Адрес фронтенда (по умолчанию `http://localhost:5173`) |
| `PORT`, `HOST`, `DATABASE_PATH` | Необязательно: порт (8000), адрес (127.0.0.1), файл БД (`db.sqlite3`) |
| `REDIS_URL` | Общий кеш для кодов и rate limit; пусто = кеш в памяти процесса |
| `LOG_LEVEL` | Уровень логов (по умолчанию `INFO`) |
| `GOOGLE_CLIENT_ID` | OAuth Client ID (Web) |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_GRAPH_VERSION` | Приложение Facebook |
| `FACEBOOK_EMAIL_FALLBACK` | Временный вход «через Facebook» по email-коду, пока приложение не настроено |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Продакшен: включает webhook вместо опроса `getUpdates` |
| `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_PORT`, `EMAIL_USE_SSL`, `DEFAULT_FROM_EMAIL` | SMTP; без `EMAIL_HOST` письма печатаются в консоль |
| `EMAIL_CODE_TTL` | Срок жизни кода в секундах (по умолчанию 120) |
| `EMAIL_TEST_CODE`, `SOCIAL_AUTH_MOCK` | Тестовые режимы, работают только при `DEBUG=True` |

### Frontend (`frontend/.env`)

| Переменная | Назначение |
|---|---|
| `VITE_API_URL` | Адрес API (по умолчанию `http://localhost:8000/api`) |
| `VITE_GOOGLE_CLIENT_ID` | Тот же Client ID, что и на бэкенде |
| `VITE_FACEBOOK_APP_ID`, `VITE_FACEBOOK_GRAPH_VERSION` | Тот же App ID, что и на бэкенде |
| `VITE_TELEGRAM_BOT_NAME` | Username бота без `@` |
| `VITE_FACEBOOK_EMAIL_FALLBACK` | Пара к `FACEBOOK_EMAIL_FALLBACK` |
| `VITE_MOCK_AUTH` | Пара к `SOCIAL_AUTH_MOCK` |

### Реальная отправка писем (Gmail)

1. Включите двухэтапную проверку в аккаунте Google.
2. Создайте пароль приложения: https://myaccount.google.com/apppasswords (16 символов).
3. В `backend-node/.env`:
   ```env
   EMAIL_HOST=smtp.gmail.com
   EMAIL_HOST_USER=you@gmail.com
   EMAIL_HOST_PASSWORD=abcdefghijklmnop   # пароль приложения, без пробелов
   ```
4. Проверьте: перезапустите бэкенд и запросите код на `/signup` или `/forgot-password`.
   Если SMTP недоступен, API вернёт `503`, а причина появится в логе бэкенда.

Подойдёт любой SMTP: Яндекс (`smtp.yandex.ru`, порт 465, `EMAIL_USE_SSL=True`), Mail.ru,
SendGrid, Mailgun.

### Тестовые режимы (только при `DEBUG=True`)

| Режим | Как включить | Что делает |
|---|---|---|
| Тестовый код email | `EMAIL_TEST_CODE=12345` | Письма не отправляются, любой код подтверждения равен `12345` |
| Имитация соцсетей | `SOCIAL_AUTH_MOCK=True` + `VITE_MOCK_AUTH=true` | Кнопки провайдеров **без ключей** открывают `/connect/<provider>`: Google и Facebook спрашивают email, Telegram спрашивает username, затем код `12345` |

При имитации ничего не отправляется. Дальше всё работает по-настоящему: пользователь создаётся,
выдаются JWT, работают привязка и отвязка, refresh и logout. Как только у провайдера появляется
реальный ключ, его кнопка работает по-настоящему. При `DEBUG=False` бэкенд отклоняет оба режима
(это покрыто тестами).

## Как это устроено

### Email и пароль

```
Sign up:  {name, email, password, password_confirm} ─▶ POST /email/signup/          ─▶ письмо с кодом
          {email, code}                             ─▶ POST /email/verify/          ─▶ аккаунт создан (без входа)
Sign in:  {email, password}                         ─▶ POST /login/                 ─▶ сессия
Reset:    {email}                                   ─▶ POST /password/reset/         ─▶ письмо с кодом
          {email, code}                             ─▶ POST /password/reset/verify/  ─▶ reset_token
          {token, password, password_confirm}       ─▶ POST /password/reset/confirm/ ─▶ сессия
```

**Пароли**
- Проверяются теми же правилами и с теми же сообщениями, что валидаторы Django: не короче
  8 символов, не из списка 20 000 частых, не только цифры, не похож на имя или email.
- Хранится только хеш в формате Django: PBKDF2-SHA256, 1 500 000 итераций. Хеши со старыми
  настройками пересчитываются при следующем входе.
- Аккаунт создаётся только после подтверждения email. До этого хеш пароля хранится рядом с кодом,
  поэтому повторная отправка кода не требует от фронтенда держать пароль у себя.
- После подтверждения кода вход **не выполняется**: пользователь попадает на `/login`
  с подставленным email и входит паролем.
- Неверный пароль и несуществующий email дают одинаковый ответ `401` с одинаковым временем
  ответа, так что вход не раскрывает, какие email зарегистрированы.

**Коды подтверждения**
- 6 цифр из криптостойкого генератора (`crypto.randomInt`), живут 2 минуты (`EMAIL_CODE_TTL`),
  одноразовые. В БД хранится только HMAC. Код регистрации не подходит для сброса пароля, и наоборот.
- После 5 неверных попыток код сгорает. Новый код отменяет старый. Повторная отправка возможна
  не чаще раза в 60 с (`429` + `Retry-After`) и не больше 5 кодов в час на адрес.
- Письмо отправляется **до** сохранения кода. Если SMTP недоступен, API вернёт `503`, а лимиты
  не потратятся. Таймаут SMTP 10 с.
- Регистрация с занятым email возвращает `409 account_exists`, сброс для неизвестного email
  возвращает `404 account_not_found`. Фронтенд показывает ссылку на нужную страницу.

**Сброс пароля**
- После кода выдаётся подписанный `reset_token` на 10 минут. В нём отпечаток текущего хеша
  пароля, поэтому после смены пароля токен перестаёт работать.
- После смены пароля все прежние сессии завершаются: refresh-токены попадают в blacklist.
- Пользователь, зарегистрированный через соцсеть, тем же способом может задать себе пароль.

### Google и Facebook

```
Браузер ──(1) вход у провайдера──▶ Google / Facebook
   │◀──────── ID token / access token
   └──(2) POST /api/auth/<provider>/ ──▶ Backend
                                          ├─ (3) проверка подписи / токена у провайдера
                                          ├─ (4) поиск, создание или привязка пользователя
                                          └─ (5) access token в JSON + refresh token в httpOnly cookie
```

| Провайдер | Что присылает фронтенд | Как проверяет бэкенд |
|---|---|---|
| Google | ID token (JWT) от Google Identity Services | Подпись по публичным ключам Google, `aud` = наш Client ID, `iss` |
| Facebook | User access token из JS SDK | `debug_token`: токен валиден и выдан **нашему** приложению; профиль запрашивается с `appsecret_proof` |

**Временная замена Facebook.** Пока приложение Facebook не настроено, можно включить
`FACEBOOK_EMAIL_FALLBACK=True` и `VITE_FACEBOOK_EMAIL_FALLBACK=true`. Тогда «Continue with Facebook»
просит email, отправляет на него настоящий код и после кода входит в аккаунт с этим email
(или создаёт его). Это вход по email-коду, а не привязка Facebook: записей Facebook в базе
не появляется. Как только задан `FACEBOOK_APP_ID`, замена выключается сама.

### Telegram

```
«Continue with Telegram» ─▶ POST /telegram/login/start/ ─▶ сессия страницы (10 мин) + ссылка t.me/<bot>
В боте: кнопка «🔑 Get sign-in code» ─▶ бот присылает код («📋 Copy code» копирует его)
На сайте: код ─▶ POST /telegram/login/verify/ ─▶ сессия
```

- **`/start` нужен один раз.** Telegram не разрешает боту писать первым. На первый Start бот
  отвечает кодом и включает постоянную кнопку под полем ввода (reply keyboard). Дальше
  пользователь нажимает её, и она отправляет обычный текст. Username вводить не нужно.
- **Код подтверждает тот аккаунт Telegram, которому он отправлен.** Сообщение боту приходит
  от настоящего аккаунта, и Telegram это гарантирует. Код хранится как HMAC, одноразовый,
  живёт 2 минуты, новый код отменяет предыдущий, получить новый можно раз в 60 с.
- **Защита от подбора.** Код ищется по значению, поэтому попытки ограничены: 5 на страницу
  входа и 10 проверок в минуту с IP.
- **Как бот получает сообщения.** Локально, пока страница входа открыта, она раз в 2 с опрашивает
  бэкенд, а бэкенд забирает сообщения бота через `getUpdates`. Публичный адрес не нужен, всё
  работает на localhost. Блокировка в кеше не даёт двум опросам обработать сообщение дважды.
  В продакшене включается webhook: Telegram сам присылает сообщения
  (см. [Перед продакшеном](#перед-продакшеном)).
- Есть и альтернативный эндпоинт для Telegram Login Widget с проверкой HMAC-подписи
  (`POST /api/auth/telegram/`).

## API

Интерактивная документация (Swagger UI): **http://localhost:8000/api/docs/**.
Схема OpenAPI: `/api/schema/`.

| Метод | URL | Описание |
|---|---|---|
| POST | `/api/auth/email/signup/` | `{name, email, password, password_confirm}` → код на почту |
| POST | `/api/auth/email/verify/` | `{email, code}` → аккаунт создан (без входа) |
| POST | `/api/auth/email/resend/` | `{email, purpose: "signup" \| "reset"}` → новый код |
| POST | `/api/auth/login/` | `{email, password}` → сессия |
| POST | `/api/auth/password/reset/` | `{email}` → код на почту |
| POST | `/api/auth/password/reset/verify/` | `{email, code}` → `{reset_token}` |
| POST | `/api/auth/password/reset/confirm/` | `{token, password, password_confirm}` → сессия |
| POST | `/api/auth/google/` | `{credential}` → сессия |
| POST | `/api/auth/facebook/` | `{access_token}` → сессия (замена: `{email}`, затем `{email, code}`) |
| POST | `/api/auth/telegram/login/start/` | → `{token, bot_link, button_text, expires_in, code_length}` |
| POST | `/api/auth/telegram/login/status/` | `{token}` → `{status: "active"}`, пока страница открыта; `410`, если истекла |
| POST | `/api/auth/telegram/login/verify/` | `{token, code}` → сессия |
| POST | `/api/auth/telegram/webhook/` | Продакшен: сообщения боту от Telegram (заголовок с секретом) |
| POST | `/api/auth/telegram/` | Данные Telegram Login Widget → сессия |
| POST | `/api/auth/token/refresh/` | Refresh из cookie → новый access (refresh ротируется) |
| POST | `/api/auth/logout/` | Refresh из cookie → blacklist, cookie удаляется |
| GET, PATCH | `/api/auth/me/` | Текущий пользователь |
| DELETE | `/api/auth/social/<provider>/` | Отвязать провайдера |
| GET | `/api/auth/providers/` | Какие провайдеры настроены |

**Сессия** — это ответ `{access, user, created}` (при `created: true` регистрация, HTTP 201)
плюс refresh token в httpOnly cookie. Если запрос входа через провайдера приходит с access token,
провайдер привязывается к текущему пользователю.

**Ошибки** имеют формат, который ожидает фронтенд: `{"detail": "...", "code": "..."}` или,
для ошибок валидации, `{"поле": ["сообщение"]}` со статусом `400`.

## Безопасность и архитектурные решения

**Проверка только на сервере.** Фронтенд никогда не присылает «готовый профиль», только то,
что подписал провайдер. Бэкенд сам проверяет подпись или токен и лишь потом доверяет данным.

**Хранение токенов**
- *Access token* (15 мин) хранится только в памяти JS-модуля, не в `localStorage`.
- *Refresh token* (7 дней) лежит в cookie `HttpOnly; SameSite=Lax; Path=/api/auth/`,
  а вне DEBUG ещё и `Secure`. JavaScript, а значит и XSS, его прочитать не может.
- После перезагрузки страницы сессия восстанавливается запросом `/token/refresh/`. При ответе
  `401` axios обновляет access token одним общим запросом, даже если упало несколько запросов сразу.
- `SameSite=Lax` не даёт браузеру отправить cookie в межсайтовом POST, это защищает
  cookie-эндпоинты от CSRF. Остальные эндпоинты авторизуются заголовком `Authorization`.
- Refresh ротируется при каждом использовании, старый попадает в blacklist (таблицы
  `token_blacklist_*`).

**Связывание аккаунтов**
- Повторный вход тем же провайдером возвращает того же пользователя: пара
  `(provider, uid)` в таблице `accounts_socialaccount` уникальна.
- Совпадение email ведёт к объединению **только если провайдер подтвердил email**. Иначе можно
  было бы захватить чужой аккаунт, зарегистрировавшись у провайдера с чужим email.
- Нельзя привязать аккаунт, который уже привязан к другому пользователю (`409`), и нельзя
  отвязать последний способ входа (`400`). Email считается способом входа.
- Пользователь и социальный аккаунт создаются в одной транзакции. Гонку при одновременной
  привязке ловит уникальный индекс.

**Rate limit** считается по IP, у каждой группы свой счётчик (`THROTTLE_RATES`
в `src/config.ts`): соцсети 30/мин, email-коды 20/мин, вход по паролю 10/мин, опрос Telegram 120/мин,
проверка кода Telegram 10/мин.

**Прочее.** Запросы с неизвестным заголовком `Host` отклоняются (`DJANGO_ALLOWED_HOSTS`),
CORS разрешён только для `CORS_ALLOWED_ORIGINS`, ответы содержат заголовки `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`.

**Кеш.** Коды Telegram, временный вход Facebook и счётчики rate limit живут в кеше.
Когда процессов сервера несколько, кеш должен быть общим: `REDIS_URL` включает Redis. Без него
используется кеш в памяти процесса, этого достаточно для одного процесса и тестов.

**Слои бэкенда.** Views только разбирают запрос и формируют ответ. Логика живёт в `src/services/`:
`accounts`, `emailCodes`, `passwordAuth`, `providers`, `telegramBot`, `facebookEmail`, `mockSocial`.

## Структура проекта

```
backend-node/
  src/
    server.ts                 запуск HTTP-сервера
    app.ts                    Express: middleware (ALLOWED_HOSTS, CORS, заголовки) и маршруты
    config.ts                 настройки; всё секретное читается из .env
    db.ts                     SQLite: схема, транзакции, формат дат
    users.ts                  пользователи и JSON пользователя
    errors.ts                 типы ошибок
    openapi.ts                схема OpenAPI и Swagger UI
    http/                     view() — авторизация JWT, права, rate limit; cookie; throttle
    lib/                      пароли, JWT, кеш (память/Redis), почта, валидация, парсер .env
    services/
      providers.ts            проверка Google / Facebook / Telegram Login Widget
      accounts.ts             поиск, создание и связывание пользователя
      emailCodes.ts           email-коды (регистрация, сброс пароля), лимиты
      passwordAuth.ts         вход по паролю, сброс пароля
      telegramBot.ts          вход через бота: коды, getUpdates и webhook
      facebookEmail.ts        временный вход «через Facebook» по email-коду
      mockSocial.ts           тестовый режим соцсетей (только DEBUG)
    views/                    API: social, telegram, email, session (+ common)
    templates/emailCode.ts    письмо с кодом (HTML и текст)
  scripts/                    migrate, telegram-webhook
  test/                       тесты (node:test + supertest)
  data/common-passwords.txt.gz  список частых паролей для валидатора
backend/                      прежний Django-бэкенд (можно удалить после перехода)
frontend/
  src/
    api/client.ts             axios: access token, авто-refresh при 401
    auth/                     AuthProvider, useAuth, хранение access token в памяти
    components/               кнопки провайдеров, формы, ввод кода (+ *.test.tsx)
    pages/                    Sign in / Sign up / Verify / Forgot / Reset / Telegram / Connect / профиль
    ui.ts                     общие наборы Tailwind-классов
    index.css                 тема Tailwind: цвета, тёмный режим
    validation.ts             проверки форм, извлечение кода из вставленного текста
    types.ts                  типы API
  scripts/vitest.mjs          запуск тестов (обход бага Vitest с регистром диска в Windows)
.github/workflows/ci.yml      CI
```

## Тесты и CI

```bash
# backend (из папки backend-node)
npm test                                               # 119 тестов
npm run typecheck

# frontend (из папки frontend)
npm test                                               # 27 тестов
npm run typecheck
npm run lint
npm run format:check
npm run build
```

**Бэкенд.** Тесты проверяют:
- проверку токена Facebook (ответы Graph API подменяются) и HMAC-подписи Telegram Login Widget;
- вход через Google и связывание аккаунтов (проверка подписи Google подменяется);
- коды и их лимиты, вход по паролю, сброс пароля, тексты ошибок валидации;
- ротацию и blacklist refresh-токенов;
- бота Telegram (с фейковым Bot API) и webhook;
- тестовые режимы и их отключение при `DEBUG=False`;
- совместимость с данными Django: хеши паролей, HMAC кодов и JWT сверены со значениями,
  которые выдал настоящий Django;
- генерацию схемы OpenAPI, CORS, `ALLOWED_HOSTS`, разбор `.env`.

Каждый тест работает с чистой базой в памяти, поэтому настоящий `db.sqlite3` не затрагивается.

**Фронтенд:** формы, ввод и вставка кода, валидация.

GitHub Actions (`.github/workflows/ci.yml`) запускает все эти проверки на каждый push
и pull request.

## Получение ключей провайдеров

### Google
1. https://console.cloud.google.com/ → APIs & Services → **OAuth consent screen**: настроить
   и в *Test users* добавить свой аккаунт.
2. Credentials → Create credentials → **OAuth client ID** → *Web application*.
3. *Authorized JavaScript origins*: `http://localhost:5173` и `http://localhost`.
4. Client ID → `GOOGLE_CLIENT_ID` (backend) и `VITE_GOOGLE_CLIENT_ID` (frontend). Secret не нужен.

### Facebook
1. https://developers.facebook.com/apps → Create app → use case *Facebook Login*.
2. Добавить разрешение `email`. В настройках Facebook Login, в поле *Allowed Domains for the
   JavaScript SDK*, указать `localhost`.
3. Settings → Basic: App ID → `FACEBOOK_APP_ID` и `VITE_FACEBOOK_APP_ID`,
   App Secret → `FACEBOOK_APP_SECRET` (**только backend**).
4. В режиме Development войти могут только пользователи с ролью в приложении. Для продакшена
   нужен HTTPS.

### Telegram
1. [@BotFather](https://t.me/BotFather): `/newbot` → токен → `TELEGRAM_BOT_TOKEN` (**только backend**).
2. Username бота без `@` → `VITE_TELEGRAM_BOT_NAME`.

Домен и туннель для локальной разработки не нужны.

## Перед продакшеном

- Свой `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, корректный `DJANGO_ALLOWED_HOSTS`.
  Тестовые режимы при `DEBUG=False` выключаются сами.
- Запуск через `npm start` под менеджером процессов (systemd, pm2, Docker), `HOST=0.0.0.0`
  или за reverse proxy (nginx).
- HTTPS. Cookie получит флаг `Secure` автоматически.
- Фронтенд и API на одном сайте (например, `example.com` и `api.example.com`), иначе cookie
  с `SameSite=Lax` не будет отправляться. Для разных сайтов нужен `SameSite=None` и CSRF-токен.
- PostgreSQL вместо SQLite.
- Redis: `REDIS_URL`, чтобы кеш кодов и rate limit был общим для всех процессов.
- Telegram webhook: задать `TELEGRAM_WEBHOOK_SECRET` (длинная случайная строка) и выполнить
  `npm run telegram-webhook -- --url https://<домен>/api/auth/telegram/webhook/`.
  Вернуться к опросу можно командой `npm run telegram-webhook -- --delete`.
- SMTP-сервис (`EMAIL_HOST` и т.д.). Отправку писем лучше вынести в очередь (BullMQ и т.п.),
  чтобы запрос не ждал SMTP.

## Переход с Django

Node-бэкенд — полная замена Django-бэкенда: те же URL, JSON-ответы, коды ошибок, cookie
и rate limits. Фронтенд менять не нужно.

```bash
cp backend/.env backend-node/.env           # те же переменные, тот же DJANGO_SECRET_KEY
cp backend/db.sqlite3 backend-node/         # та же база
```

- **Пользователи и пароли сохраняются.** Хеши паролей в формате Django проверяются как есть.
- **Активные сессии не слетают**, если не менять `DJANGO_SECRET_KEY`: JWT в формате SimpleJWT,
  тот же blacklist.
- **Схема БД не меняется** (таблицы, созданные Django), поэтому вернуться на Django можно в любой момент.
- **Команды:**

  | Django | Node |
  |---|---|
  | `manage.py runserver` | `npm run dev` |
  | `manage.py migrate` | `npm run migrate` (или просто запуск сервера) |
  | `manage.py test accounts` | `npm test` |
  | `manage.py telegram_webhook --url …` / `--delete` | `npm run telegram-webhook -- --url …` / `-- --delete` |

- **Django admin (`/admin/`) не перенесена.** Данные можно смотреть любым SQLite-клиентом
  (например, DB Browser for SQLite).
- Оба бэкенда по умолчанию слушают порт 8000, поэтому одновременно их не запускайте.
- После перехода папку `backend/` можно удалить. В CI пока проверяются оба бэкенда.

Подробнее — в [`backend-node/README.md`](backend-node/README.md).

## Известные упрощения

Это осознанные упрощения для тестового задания:

- Таблицы пользователей унаследованы от Django (`auth_user`), включая неиспользуемые поля
  `is_staff` и `is_superuser`.
- База SQLite.
- Вход «через Facebook» по email-коду работает как временная замена, пока приложение Facebook
  не настроено.
- Письма отправляются синхронно, без очереди.
