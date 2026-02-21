# Supabase Setup

## 1. Создание таблицы profiles

Выполните SQL из файла `migrations/001_create_profiles.sql` в Supabase SQL Editor:

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите ваш проект
3. Перейдите в **SQL Editor**
4. Скопируйте и выполните содержимое файла `migrations/001_create_profiles.sql`

## 2. Настройка переменных окружения

Создайте файл `.env` в корне проекта (на основе `.env.example`):

```bash
EXPO_PUBLIC_SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
EXPO_PUBLIC_APP_NAME="Poker AI Coach"
```

## 3. Проверка

После выполнения миграции проверьте:

1. **Таблица создана**: Table Editor → profiles
2. **RLS включён**: policies должны быть активны
3. **Anonymous auth включён**: Authentication → Providers → Anonymous Users (должен быть enabled)

## 4. Enable Anonymous Sign-In

В Supabase Dashboard:
1. Перейдите в **Authentication** → **Providers**
2. Найдите **Anonymous Sign-In**
3. Включите переключатель **Enable Anonymous Sign-In**
4. Сохраните изменения

## Структура таблицы profiles

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid | PK, FK → auth.users(id) |
| skill_level | text | beginner/intermediate/advanced |
| plays_for_money | text | no/sometimes/regular/income |
| game_types | text[] | mtt, cash, sng, live |
| goals | text[] | Цели игрока |
| weak_areas | text[] | Слабые места |
| coach_style | text | toxic/mental/math |
| created_at | timestamp | Дата создания |
| updated_at | timestamp | Дата обновления |

## RLS Policies

1. **"Users can manage their profile"** - авторизованные пользователи могут управлять своим профилем
2. **"Anonymous users can manage their profile"** - анонимные пользователи могут управлять своим профилем

Обе политики используют `auth.uid()` и `auth.jwt()` для проверки владельца профиля.
