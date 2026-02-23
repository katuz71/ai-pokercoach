# Skill Model — внедрение и проверка

## Список изменённых/созданных файлов

| Файл | Действие |
|------|----------|
| `supabase/migrations/012_training_events_is_correct_leak_tag.sql` | **Создан** — колонки `is_correct`, `leak_tag` в `training_events`, индекс |
| `supabase/migrations/013_skill_ratings_and_rpc.sql` | **Создан** — таблица `skill_ratings`, RLS, RPC `rpc_update_skill_rating` |
| `supabase/functions/ai-submit-table-drill-result/index.ts` | **Изменён** — insert с `is_correct`/`leak_tag`, вызов RPC, ответ с `skill_rating` |

---

## Текст миграций

### 012_training_events_is_correct_leak_tag.sql

```sql
-- Add is_correct and leak_tag to training_events for skill_ratings and 7d/30d counts
alter table training_events
  add column if not exists is_correct boolean not null default false,
  add column if not exists leak_tag text;

comment on column training_events.is_correct is 'True when user_action = correct_action';
comment on column training_events.leak_tag is 'Leak tag this drill was for (from drill_queue)';

create index if not exists training_events_user_leak_created_idx
  on training_events(user_id, leak_tag, created_at desc);
```

### 013_skill_ratings_and_rpc.sql

См. файл целиком: `supabase/migrations/013_skill_ratings_and_rpc.sql`  
(таблица `skill_ratings`, RLS, функция `rpc_update_skill_rating`).

---

## Где вызывается `rpc_update_skill_rating`

**Файл:** `supabase/functions/ai-submit-table-drill-result/index.ts`

1. **Хелпер** (строки ~42–92):

```ts
async function updateSkillRatingIfAllowed(
  supabaseUser: { rpc: (...) => ... },
  leakTag: string,
  isCorrect: boolean,
  practicedAt: string,
): Promise<{ leak_tag, rating, streak_correct, ... } | null> {
  if (leakTag == null || String(leakTag).trim() === '') return null;
  try {
    const { data: row, error } = await supabaseUser.rpc('rpc_update_skill_rating', {
      p_leak_tag: leakTag,
      p_is_correct: isCorrect,
      p_practiced_at: practicedAt,
    });
    // ... map row to response shape, return or null
  } catch (e) { ... return null; }
}
```

2. **Вызов после успешного ответа (correct)** — ~строки 178–181:

```ts
const baseResponse = { ok: true, correct: true, explanation: ..., next_due_at: nextDue, repetition: newRep };
const skillRating = await updateSkillRatingIfAllowed(supabaseUser, enforcedLeakTag, correct, now);
return json(skillRating != null ? { ...baseResponse, skill_rating: skillRating } : baseResponse);
```

3. **Вызов после неправильного ответа (incorrect)** — ~строки 204–207:

```ts
const baseResponse = { ok: true, correct: false, ... };
const skillRating = await updateSkillRatingIfAllowed(supabaseUser, enforcedLeakTag, correct, now);
return json(skillRating != null ? { ...baseResponse, skill_rating: skillRating } : baseResponse);
```

Если `leak_tag` пустой или null — RPC не вызывается, ответ без `skill_rating` (как раньше).

---

## Как проверить

### 1. Применить миграции

```bash
cd /path/to/AI_PokerCoach
npx supabase db push
# или для локального стека:
npx supabase db reset
```

Убедиться, что миграции 012 и 013 применились без ошибок.

### 2. Задеплоить Edge-функцию

```bash
npx supabase functions deploy ai-submit-table-drill-result --project-ref <YOUR_PROJECT_REF>
```

### 3. Вызвать API (curl / Postman)

- **URL:** `POST https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/ai-submit-table-drill-result`
- **Headers:**  
  `Content-Type: application/json`  
  `Authorization: Bearer <ANON_KEY>`  
  `apikey: <ANON_KEY>`  
  `x-user-jwt: <USER_ACCESS_TOKEN>` (токен из `supabase.auth.getSession()` после входа пользователя)

**Пример тела (подставь свой `drill_queue_id` из таблицы `drill_queue`):**

```json
{
  "drill_queue_id": "<uuid из drill_queue>",
  "scenario": {
    "correct_action": "call",
    "explanation": "Pot odds justify a call.",
    "hero_cards": ["As", "Kh"],
    "pot_bb": 30,
    "action_to_hero": { "type": "bet", "size_bb": 15 }
  },
  "user_action": "call"
}
```

**Ожидаемый ответ (фрагмент):**

- `ok: true`, `correct: true/false`, `explanation`, `next_due_at`, `repetition`
- При непустом `leak_tag` у записи в `drill_queue` в ответе есть **`skill_rating`**:
  - `leak_tag`, `rating` (0–100), `streak_correct`, `attempts_7d`, `correct_7d`, `attempts_30d`, `correct_30d`, `total_attempts`, `total_correct`, `last_practice_at`, `last_mistake_at`

**Проверка в БД:**

- В таблице `skill_ratings` должна появиться/обновиться строка для `user_id` и `leak_tag` (например `fundamentals`).
- `rating`: +4 за правильный ответ, −6 за неправильный, в границах 0–100.
- `training_events`: у новой записи заполнены `is_correct` и `leak_tag`.

---

## Критерии приёмки (чек-лист)

- [ ] После отправки table-drill результата создаётся/обновляется запись в `skill_ratings` для данного `leak_tag`.
- [ ] `rating` меняется: +4 за correct, −6 за mistake, clamp 0..100; streak корректно сбрасывается при ошибке.
- [ ] `attempts_7d`/`correct_7d` и `attempts_30d`/`correct_30d` пересчитываются из `training_events` (есть индекс `training_events_user_leak_created_idx`).
- [ ] RLS: пользователь видит/меняет только свои строки в `skill_ratings`.
- [ ] `ai-submit-table-drill-result` возвращает объект `skill_rating` в ответе при непустом `leak_tag`.
