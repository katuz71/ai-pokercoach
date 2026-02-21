# Action Plan Tracker Implementation

## Обзор
Action Plan Tracker на 7 дней для исправления топ ошибки игрока (#1 leak).

## Компоненты

### 1. Database Migration: `007_create_action_plans.sql`

Создана таблица `action_plans`:
- `id` - UUID primary key
- `user_id` - ссылка на auth.users
- `period_start`, `period_end` - даты периода
- `focus_tag` - тег топ ошибки
- `items` - JSONB массив [{id, text, done}]
- `created_at`, `updated_at` - timestamps

**Особенности:**
- RLS: user может select/insert/update только свои записи
- Unique constraint: (user_id, period_start, period_end) - один план на период
- Trigger: автоматическое обновление updated_at
- Index: быстрый поиск по (user_id, period_start desc)

### 2. Edge Function: `ai-generate-action-plan`

**Flow:**
1. Получает latest `leak_summaries` для пользователя
2. Берет `top_leaks[0].tag` как focus_tag
3. Если нет leaks → возврат 400 "no_leaks_found"
4. OpenAI генерирует 5 практичных пунктов
5. Сохраняет в `action_plans` (upsert)
6. Возвращает JSON с plan_id, period, focus_tag, items

**Items структура:**
```json
{
  "id": "day1",  // stable ID: day1..day5
  "text": "Практичное действие",
  "done": false
}
```

**Period:**
- `period_start` = today (UTC)
- `period_end` = today + 6 days (7 дней всего)

### 3. Types

**types/actionPlan.ts:**
- `ActionPlanItem` - {id, text, done}
- `ActionPlan` - полная запись из БД
- `ActionPlanResponse` - ответ от Edge Function

**types/database.ts:**
- Добавлена таблица `action_plans` в Database type
- Экспорт `ActionPlanRow`

### 4. UI: `app/(tabs)/profile.tsx`

**Добавлено:**
- State: actionPlan, loadingActionPlan, actionPlanError
- `loadCurrentActionPlan()` - загрузка текущего плана на период
- `generateActionPlan()` - вызов Edge Function
- `toggleActionPlanItem(itemId)` - toggle done и update в БД (optimistic)

**UI Секция:**
- Расположена после "Coach Review"
- Заголовок: "Action Plan (7 дней)"
- Focus tag badge с периодом
- Checklist items (TouchableOpacity)
- Кнопка: "Сгенерировать план" / "Обновить план"

**Стили:**
- Checkbox с галочкой при done
- Зачеркнутый текст + opacity 0.5 для done items
- Card с минимальным padding
- Blue accent (#4C9AFF) для активных элементов

## Пример JSON ответа

```json
{
  "plan_id": "550e8400-e29b-41d4-a716-446655440000",
  "period_start": "2026-02-17",
  "period_end": "2026-02-23",
  "focus_tag": "preflop_mistakes",
  "items": [
    {
      "id": "day1",
      "text": "Изучи чарт префлоп рейзов для UTG позиции",
      "done": false
    },
    {
      "id": "day2",
      "text": "Практикуй фолды слабых рук в ранней позиции",
      "done": false
    }
  ]
}
```

## Использование

1. Пользователь заходит в Profile
2. Видит секцию "Action Plan (7 дней)"
3. Нажимает "Сгенерировать план"
4. Edge Function берет топ ошибку из leak_summary
5. AI генерирует 5 конкретных действий
6. План сохраняется и отображается
7. Пользователь отмечает выполненные пункты (toggle checkbox)

## Зависимости

- Требует: latest `leak_summary` (иначе 400 error)
- OpenAI API: модель gpt-4o-mini
- Supabase: auth, RLS, JSONB

## Тестирование

1. Создать несколько hand_analyses с mistake_tags
2. Сгенерировать leak_summary через "Coach Review"
3. Нажать "Сгенерировать план" в секции Action Plan
4. Проверить checklist
5. Toggle items и проверить сохранение в БД
