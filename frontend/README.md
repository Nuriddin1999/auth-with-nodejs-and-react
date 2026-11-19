# Auth: Google / Facebook / Telegram / Email

Регистрация и вход через Google, Facebook, Telegram, а также по email и паролю
с подтверждением email кодом.

- **Frontend:** React 19, TypeScript (strict), Vite 8, Tailwind CSS v4, React Router 7, axios.
- **Backend:** Django 6.1, Django REST Framework, SimpleJWT, drf-spectacular (OpenAPI).
- **Качество:** 97 тестов бэкенда, 27 тестов фронтенда (Vitest + Testing Library), Ruff,
  oxlint, Prettier, CI в GitHub Actions.

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
11. [Известные упрощения](#известные-упрощения)

## Возможности

| Страница           | Что происходит                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/signup`          | Имя, email, пароль и подтверждение → код на почту (`/verify`) → аккаунт создан → `/login` с подставленным email → вход |
| `/login`           | Email и пароль **или** Google / Facebook / Telegram; ссылка «Forgot password?»                                         |
| `/forgot-password` | Email → код на почту (`/verify`) → новый пароль (`/reset-password`) → вход                                             |
| `/telegram`        | Вход через бота: кнопка в боте присылает код, код вводится на сайте                                                    |
| `/`                | Профиль: подключённые способы входа (подключить и отключить), пароль (задать и сменить), выход                         |

- Соцсети регистрируют при первом входе и логинят при следующих, поэтому кнопки одинаковые
  на обеих страницах (ниже формы, как на большинстве сайтов).
- Кнопки отправки неактивны, пока обязательные поля не заполнены.
- Код можно вставить из буфера обмена: через `Ctrl+V` или кнопку «Paste». Цифры извлекаются
  и из вида `482 913`, и из целого сообщения бота.
- Аккаунты связываются: Google с тем же подтверждённым email попадает в тот же аккаунт.
- Тёмная тема по настройке системы.

## Быстрый старт

Нужны **Python 3.12+** (проверено на 3.14) и **Node.js 20.19+ / 22+**.

```bash
# backend → http://localhost:8000
cd backend
py -m venv venv                                    # macOS/Linux: python3 -m venv venv
venv\Scripts\pip install -r requirements-dev.txt   # macOS/Linux: venv/bin/pip ...
copy .env.example .env                             # macOS/Linux: cp
venv\Scripts\python manage.py migrate
venv\Scripts\python manage.py runserver

# frontend → http://localhost:5173
cd frontend
npm install
copy .env.example .env
npm run dev
```

Без ключей провайдеров работает регистрация и вход по email. Письма при этом печатаются
в консоль `runserver`:

```
Subject: 281632 is your verification code
...
Your code to finish signing up: 281632
```

Чтобы посмотреть весь интерфейс без SMTP и без ключей провайдеров, включите
[тестовые режимы](#тестовые-режимы-только-при-debugtrue).

## Настройка

Все секреты читаются из `backend/.env` и никогда не попадают во фронтенд. Шаблоны лежат
в `backend/.env.example` и `frontend/.env.example`. После изменения `.env` перезапустите
`runserver` или `npm run dev`.

### Backend (`backend/.env`)

| Переменная                                                                                                  | Назначение                                                                  |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`                                                 | Стандартные настройки Django                                                |
| `CORS_ALLOWED_ORIGINS`                                                                                      | Адрес фронтенда (по умолчанию `http://localhost:5173`)                      |
| `REDIS_URL`                                                                                                 | Общий кеш для кодов и rate limit; пусто = кеш в памяти процесса             |
| `LOG_LEVEL`                                                                                                 | Уровень логов приложения `accounts` (по умолчанию `INFO`)                   |
| `GOOGLE_CLIENT_ID`                                                                                          | OAuth Client ID (Web)                                                       |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_GRAPH_VERSION`                                          | Приложение Facebook                                                         |
| `FACEBOOK_EMAIL_FALLBACK`                                                                                   | Временный вход «через Facebook» по email-коду, пока приложение не настроено |
| `TELEGRAM_BOT_TOKEN`                                                                                        | Токен бота от @BotFather                                                    |
| `TELEGRAM_WEBHOOK_SECRET`                                                                                   | Продакшен: включает webhook вместо опроса `getUpdates`                      |
| `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_PORT`, `EMAIL_USE_SSL`, `DEFAULT_FROM_EMAIL` | SMTP; без `EMAIL_HOST` письма печатаются в консоль                          |
| `EMAIL_CODE_TTL`                                                                                            | Срок жизни кода в секундах (по умолчанию 120)                               |
| `EMAIL_TEST_CODE`, `SOCIAL_AUTH_MOCK`                                                                       | Тестовые режимы, работают только при `DEBUG=True`                           |

### Frontend (`frontend/.env`)

| Переменная                                            | Назначение                                           |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `VITE_API_URL`                                        | Адрес API (по умолчанию `http://localhost:8000/api`) |
| `VITE_GOOGLE_CLIENT_ID`                               | Тот же Client ID, что и на бэкенде                   |
| `VITE_FACEBOOK_APP_ID`, `VITE_FACEBOOK_GRAPH_VERSION` | Тот же App ID, что и на бэкенде                      |
| `VITE_TELEGRAM_BOT_NAME`                              | Username бота без `@`                                |
| `VITE_FACEBOOK_EMAIL_FALLBACK`                        | Пара к `FACEBOOK_EMAIL_FALLBACK`                     |
| `VITE_MOCK_AUTH`                                      | Пара к `SOCIAL_AUTH_MOCK`                            |

### Реальная отправка писем (Gmail)

1. Включите двухэтапную проверку в аккаунте Google.
2. Создайте пароль приложения: https://myaccount.google.com/apppasswords (16 символов).
3. В `backend/.env`:
   ```env
   EMAIL_HOST=smtp.gmail.com
   EMAIL_HOST_USER=you@gmail.com
   EMAIL_HOST_PASSWORD=abcdefghijklmnop   # пароль приложения, без пробелов
   ```
4. Проверьте: `venv\Scripts\python manage.py sendtestemail you@gmail.com`.

Подойдёт любой SMTP: Яндекс (`smtp.yandex.ru`, порт 465, `EMAIL_USE_SSL=True`), Mail.ru,
SendGrid, Mailgun.

### Тестовые режимы (только при `DEBUG=True`)

| Режим              | Как включить                                    | Что делает                                                                                                                                             |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Тестовый код email | `EMAIL_TEST_CODE=12345`                         | Письма не отправляются, любой код подтверждения равен `12345`                                                                                          |
| Имитация соцсетей  | `SOCIAL_AUTH_MOCK=True` + `VITE_MOCK_AUTH=true` | Кнопки провайдеров **без ключей** открывают `/connect/<provider>`: Google и Facebook спрашивают email, Telegram спрашивает username, затем код `12345` |

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

- Проверяются стандартными валидаторами Django: не короче 8 символов, не из списка частых,
  не только цифры, не похож на имя или email. Хранится только хеш (PBKDF2).
- Аккаунт создаётся только после подтверждения email. До этого хеш пароля хранится рядом с кодом,
  поэтому повторная отправка кода не требует от фронтенда держать пароль у себя.
- После подтверждения кода вход **не выполняется**: пользователь попадает на `/login`
  с подставленным email и входит паролем.
- Неверный пароль и несуществующий email дают одинаковый ответ `401` с одинаковым временем
  ответа, так что вход не раскрывает, какие email зарегистрированы.

**Коды подтверждения**

- 6 цифр из `secrets`, живут 2 минуты (`EMAIL_CODE_TTL`), одноразовые. В БД хранится только HMAC.
  Код регистрации не подходит для сброса пароля, и наоборот.
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
   └──(2) POST /api/auth/<provider>/ ──▶ Django
                                          ├─ (3) проверка подписи / токена у провайдера
                                          ├─ (4) поиск, создание или привязка пользователя
                                          └─ (5) access token в JSON + refresh token в httpOnly cookie
```

| Провайдер | Что присылает фронтенд                     | Как проверяет бэкенд                                                                                  |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Google    | ID token (JWT) от Google Identity Services | Подпись по публичным ключам Google, `aud` = наш Client ID, `iss`                                      |
| Facebook  | User access token из JS SDK                | `debug_token`: токен валиден и выдан **нашему** приложению; профиль запрашивается с `appsecret_proof` |

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

Интерактивная документация (Swagger, генерируется drf-spectacular):
**http://localhost:8000/api/docs/**. Схема OpenAPI: `/api/schema/`.

| Метод      | URL                                 | Описание                                                                     |
| ---------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| POST       | `/api/auth/email/signup/`           | `{name, email, password, password_confirm}` → код на почту                   |
| POST       | `/api/auth/email/verify/`           | `{email, code}` → аккаунт создан (без входа)                                 |
| POST       | `/api/auth/email/resend/`           | `{email, purpose: "signup" \| "reset"}` → новый код                          |
| POST       | `/api/auth/login/`                  | `{email, password}` → сессия                                                 |
| POST       | `/api/auth/password/reset/`         | `{email}` → код на почту                                                     |
| POST       | `/api/auth/password/reset/verify/`  | `{email, code}` → `{reset_token}`                                            |
| POST       | `/api/auth/password/reset/confirm/` | `{token, password, password_confirm}` → сессия                               |
| POST       | `/api/auth/google/`                 | `{credential}` → сессия                                                      |
| POST       | `/api/auth/facebook/`               | `{access_token}` → сессия (замена: `{email}`, затем `{email, code}`)         |
| POST       | `/api/auth/telegram/login/start/`   | → `{token, bot_link, button_text, expires_in, code_length}`                  |
| POST       | `/api/auth/telegram/login/status/`  | `{token}` → `{status: "active"}`, пока страница открыта; `410`, если истекла |
| POST       | `/api/auth/telegram/login/verify/`  | `{token, code}` → сессия                                                     |
| POST       | `/api/auth/telegram/webhook/`       | Продакшен: сообщения боту от Telegram (заголовок с секретом)                 |
| POST       | `/api/auth/telegram/`               | Данные Telegram Login Widget → сессия                                        |
| POST       | `/api/auth/token/refresh/`          | Refresh из cookie → новый access (refresh ротируется)                        |
| POST       | `/api/auth/logout/`                 | Refresh из cookie → blacklist, cookie удаляется                              |
| GET, PATCH | `/api/auth/me/`                     | Текущий пользователь                                                         |
| DELETE     | `/api/auth/social/<provider>/`      | Отвязать провайдера                                                          |
| GET        | `/api/auth/providers/`              | Какие провайдеры настроены                                                   |

**Сессия** — это ответ `{access, user, created}` (при `created: true` регистрация, HTTP 201)
плюс refresh token в httpOnly cookie. Если запрос входа через провайдера приходит с access token,
провайдер привязывается к текущему пользователю.

## Безопасность и архитектурные решения

**Проверка только на сервере.** Фронтенд никогда не присылает «готовый профиль», только то,
что подписал провайдер. Бэкенд сам проверяет подпись или токен и лишь потом доверяет данным.

**Хранение токенов**

- _Access token_ (15 мин) хранится только в памяти JS-модуля, не в `localStorage`.
- _Refresh token_ (7 дней) лежит в cookie `HttpOnly; SameSite=Lax; Path=/api/auth/`,
  а вне DEBUG ещё и `Secure`. JavaScript, а значит и XSS, его прочитать не может.
- После перезагрузки страницы сессия восстанавливается запросом `/token/refresh/`. При ответе
  `401` axios обновляет access token одним общим запросом, даже если упало несколько запросов сразу.
- `SameSite=Lax` не даёт браузеру отправить cookie в межсайтовом POST, это защищает
  cookie-эндпоинты от CSRF. Остальные эндпоинты авторизуются заголовком `Authorization`.
- Refresh ротируется при каждом использовании, старый попадает в blacklist.

**Связывание аккаунтов**

- Повторный вход тем же провайдером возвращает того же пользователя: пара
  `SocialAccount(provider, uid)` уникальна.
- Совпадение email ведёт к объединению **только если провайдер подтвердил email**. Иначе можно
  было бы захватить чужой аккаунт, зарегистрировавшись у провайдера с чужим email.
- Нельзя привязать аккаунт, который уже привязан к другому пользователю (`409`), и нельзя
  отвязать последний способ входа (`400`). Email считается способом входа.
- Пользователь и социальный аккаунт создаются в одной транзакции. Гонку при одновременной
  привязке ловит уникальный индекс.

**Rate limit** считается по IP, у каждой группы свой счётчик (`DEFAULT_THROTTLE_RATES`
в settings): соцсети 30/мин, email-коды 20/мин, вход по паролю 10/мин, опрос Telegram 120/мин,
проверка кода Telegram 10/мин.

**Кеш.** Коды Telegram, временный вход Facebook и счётчики rate limit живут в кеше Django.
Когда процессов сервера несколько, кеш должен быть общим: `REDIS_URL` включает Redis. Без него
используется кеш в памяти процесса, этого достаточно для `runserver` и тестов.

**Слои бэкенда.** Views только разбирают запрос и формируют ответ. Логика живёт в модулях
`services`, `email_codes`, `password_auth`, `providers`, `telegram_bot`, `facebook_email`.

## Структура проекта

```
backend/
  config/settings.py          настройки; всё секретное читается из .env
  accounts/
    views/                    API: social, telegram, email, session (+ common)
    urls.py
    providers.py              проверка Google / Facebook / Telegram Login Widget
    services.py               поиск, создание и связывание пользователя, выдача JWT
    email_codes.py            email-коды (регистрация, сброс пароля), лимиты
    password_auth.py          вход по паролю, сброс пароля
    telegram_bot.py           вход через бота: коды, getUpdates и webhook
    facebook_email.py         временный вход «через Facebook» по email-коду
    mock_social.py            тестовый режим соцсетей (только DEBUG)
    cookies.py                httpOnly refresh cookie
    throttles.py              rate limit по группам эндпоинтов
    models.py                 SocialAccount, EmailCode, TelegramChat
    templates/accounts/       письмо с кодом (HTML и текст)
    management/commands/      telegram_webhook
    tests.py
  requirements.txt            зависимости приложения
  requirements-dev.txt        + инструменты разработки (ruff)
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
# backend (из папки backend)
venv\Scripts\python manage.py test accounts           # 97 тестов
venv\Scripts\ruff check . && venv\Scripts\ruff format --check .
venv\Scripts\python manage.py makemigrations --check --dry-run

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
- коды и их лимиты, вход по паролю, сброс пароля;
- ротацию и blacklist refresh-токенов;
- бота Telegram (с фейковым Bot API) и webhook;
- тестовые режимы и их отключение при `DEBUG=False`;
- генерацию схемы OpenAPI.

**Фронтенд:** формы, ввод и вставка кода, валидация.

GitHub Actions (`.github/workflows/ci.yml`) запускает все эти проверки на каждый push
и pull request.

## Получение ключей провайдеров

### Google

1. https://console.cloud.google.com/ → APIs & Services → **OAuth consent screen**: настроить
   и в _Test users_ добавить свой аккаунт.
2. Credentials → Create credentials → **OAuth client ID** → _Web application_.
3. _Authorized JavaScript origins_: `http://localhost:5173` и `http://localhost`.
4. Client ID → `GOOGLE_CLIENT_ID` (backend) и `VITE_GOOGLE_CLIENT_ID` (frontend). Secret не нужен.

### Facebook

1. https://developers.facebook.com/apps → Create app → use case _Facebook Login_.
2. Добавить разрешение `email`. В настройках Facebook Login, в поле _Allowed Domains for the
   JavaScript SDK_, указать `localhost`.
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
- HTTPS. Cookie получит флаг `Secure` автоматически.
- Фронтенд и API на одном сайте (например, `example.com` и `api.example.com`), иначе cookie
  с `SameSite=Lax` не будет отправляться. Для разных сайтов нужен `SameSite=None` и CSRF-токен.
- PostgreSQL вместо SQLite.
- Redis: `REDIS_URL`, чтобы кеш кодов и rate limit был общим для всех процессов.
- Telegram webhook: задать `TELEGRAM_WEBHOOK_SECRET` (длинная случайная строка) и выполнить
  `manage.py telegram_webhook --url https://<домен>/api/auth/telegram/webhook/`.
  Вернуться к опросу можно командой `manage.py telegram_webhook --delete`.
- SMTP-сервис (`EMAIL_HOST` и т.д.). Отправку писем лучше вынести в очередь (Celery/RQ),
  чтобы запрос не ждал SMTP.

## Известные упрощения

Это осознанные упрощения для тестового задания:

- Используется стандартная модель `User` Django. В новом проекте лучше сразу завести свою
  `AUTH_USER_MODEL`.
- База SQLite.
- Вход «через Facebook» по email-коду работает как временная замена, пока приложение Facebook
  не настроено.
- Письма отправляются синхронно, без очереди.
