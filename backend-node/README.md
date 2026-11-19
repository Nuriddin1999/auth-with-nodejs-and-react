# Backend на Node.js + TypeScript

Полная замена Django-бэкенда (`../backend`): те же URL, JSON-ответы, коды ошибок,
cookie, rate limits и та же база данных. Фронтенд менять не нужно.

**Стек:** Node.js 22.18+ (проверено на 24), TypeScript, Express 5, встроенный `node:sqlite`,
nodemailer, google-auth-library, Redis (опционально). Node запускает `.ts` напрямую,
отдельной сборки нет; `npm run typecheck` проверяет типы.

## Запуск

```bash
cd backend-node
npm install
cp ../backend/.env .env            # тот же .env, что у Django (переменные с теми же именами)
cp ../backend/db.sqlite3 .         # та же база: пользователи, пароли и сессии сохраняются
npm run dev                        # http://localhost:8000, перезапуск при изменениях
# npm start                        # без watch-режима
```

Для новой пустой базы ничего копировать не нужно: таблицы создаются при старте
(или командой `npm run migrate`).

## Что сохранено при переходе с Django

- **Пароли**: формат хешей Django (`pbkdf2_sha256`, 1 500 000 итераций). Существующие
  пользователи входят со своими паролями.
- **Сессии**: JWT в формате SimpleJWT (HS256, `DJANGO_SECRET_KEY`), тот же blacklist
  в таблицах `token_blacklist_*`. Уже выданные refresh-cookie продолжают работать —
  **если не менять `DJANGO_SECRET_KEY`**.
- **Схема БД**: точно та, что создал Django, так что при необходимости можно вернуться обратно.
- **API**: все эндпоинты `/api/auth/...`, ошибки валидации в формате DRF
  (`{"field": ["message"]}`), те же сообщения валидаторов паролей Django,
  ответы 401/403/405/429 с теми же телами и заголовками (`Retry-After`, `WWW-Authenticate`).
- **Rate limits** на IP — те же лимиты и алгоритм, что у DRF (`src/config.ts`, `THROTTLE_RATES`).
- **Документация API**: `/api/schema/` (OpenAPI) и Swagger UI на `/api/docs/`.

**Нет Django admin (`/admin/`)** — у неё нет прямого аналога. Данные можно смотреть
любым SQLite-клиентом (например, DB Browser for SQLite).

## Команды

| Django | Node |
| --- | --- |
| `manage.py runserver` | `npm run dev` |
| `manage.py migrate` | `npm run migrate` |
| `manage.py test accounts` | `npm test` |
| `manage.py telegram_webhook --url https://<домен>/api/auth/telegram/webhook/` | `npm run telegram-webhook -- --url https://<домен>/api/auth/telegram/webhook/` |
| `manage.py telegram_webhook --delete` | `npm run telegram-webhook -- --delete` |
| — | `npm run typecheck` |

Дополнительные переменные: `PORT` (8000), `HOST` (127.0.0.1), `DATABASE_PATH` (`db.sqlite3`).

## Структура

```
src/
  server.ts            запуск HTTP-сервера
  app.ts               Express: middleware (ALLOWED_HOSTS, CORS, заголовки) и маршруты
  config.ts            настройки из .env (бывший settings.py)
  db.ts                SQLite: схема Django, транзакции, формат дат
  users.ts             пользователи и JSON пользователя (бывший UserSerializer)
  errors.ts            типы ошибок
  openapi.ts           OpenAPI-схема и Swagger UI
  http/                view() — аналог APIView (JWT, права, rate limit), cookie, throttle
  lib/                 пароли, JWT, кеш (память/Redis), почта, валидация, .env-парсер
  services/            логика: email-коды, пароли, провайдеры, Telegram-бот, mock-режим
  views/               эндпоинты: social, telegram, email, session
  templates/           письмо с кодом
test/                  119 тестов (все 97 тестов Django + проверки совместимости)
```
