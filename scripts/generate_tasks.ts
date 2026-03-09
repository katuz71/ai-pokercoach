/**
 * Скрипт массовой генерации покерных задач в hand_library.
 * Первая пачка: 100 задач (10 батчей по 10).
 * Запуск: npx tsx scripts/generate_tasks.ts
 *
 * Требования в .env:
 * - OPENAI_API_KEY
 * - EXPO_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (для вставки в hand_library)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const FIRST_BATCH_TARGET = 100;
const BATCH_SIZE = 10;

const POSITIONS = ['BTN', 'SB', 'BB', 'CO', 'HJ', 'UTG', 'MP'];

type HandRow = {
  game: string;
  hero_pos: string;
  villain_pos: string;
  effective_stack_bb: number;
  hero_cards: [string, string];
  board: { flop: [string, string, string]; turn: string | null; river: string | null };
  pot_bb: number;
  street: 'flop' | 'turn' | 'river';
  action_to_hero: { type: 'bet' | 'check' | 'raise'; size_bb: number };
  correct_action: 'fold' | 'call' | 'raise';
  explanation: string;
  drill_type?: string;
};

function buildPrompt(batchIndex: number): string {
  return `Сгенерируй ровно ${BATCH_SIZE} уникальных покерных раздач (NLH) для таблицы hand_library.

Для каждой раздачи:
1. Улица (street): случайно "flop", "turn" или "river". На turn добавь board.turn, на river добавь board.turn и board.river.
2. Hero — разные комбинации: топ-пара, две пары, сет, стрит, флеш, фулл-хаус и т.д.
3. Карты в формате "Ah", "Kd", "Ts" и т.д. (ранг + масть s/h/d/c). Все карты в раздаче уникальны.
4. Позиции: hero_pos и villain_pos из списка: ${POSITIONS.join(', ')}.
5. effective_stack_bb: 20–200, pot_bb > 0. action_to_hero: type "bet"|"check"|"raise", size_bb число (если не check).
6. correct_action: "fold" | "call" | "raise".

КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ explanation (на русском, 3–4 предложения):
- Если у Hero уже ГОТОВЫЙ стрит, флеш или фулл-хаус — в explanation ОБЯЗАТЕЛЬНО назови это готовой рукой (например: "У Hero стрит", "У Hero флеш", "У Hero фулл-хаус"). Никогда не называй готовую комбинацию "дро" или "стрит-дро".
- explanation относится ТОЛЬКО к текущей улице: на флопе — только к флопу; на терне — только к терну (НЕ упоминай "флоп" в тексте); на ривере — только к риверу (НЕ упоминай "флоп" или "терн" в тексте).
- Кратко: эквити, пот-оддсы, позиция, почему correct_action верный.

Верни ТОЛЬКО JSON-массив из ${BATCH_SIZE} объектов. Каждый объект с полями:
game, hero_pos, villain_pos, effective_stack_bb, hero_cards (массив из 2 строк), board (объект с flop [3 карты], turn или null, river или null), pot_bb, street, action_to_hero (type, size_bb), correct_action, explanation.
Без markdown, без комментариев — только массив JSON.`;
}

async function generateBatch(batchIndex: number): Promise<HandRow[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Ты генератор покерных сценариев. Отвечай только валидным JSON-массивом объектов без markdown.' },
        { role: 'user', content: buildPrompt(batchIndex) },
      ],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
  const cleaned = raw.replace(/^```\w*\n?/g, '').replace(/\n?```$/g, '').trim();
  let arr: unknown[];
  try {
    arr = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Invalid JSON from OpenAI: ${cleaned.slice(0, 200)}`);
  }
  if (!Array.isArray(arr)) throw new Error('OpenAI did not return an array');

  const rows: HandRow[] = [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i] as Record<string, unknown>;
    const board = o.board as Record<string, unknown> | undefined;
    const flop = board?.flop;
    const heroCards = o.hero_cards;
    const actionToHero = o.action_to_hero as Record<string, unknown> | undefined;
    if (
      !Array.isArray(flop) || flop.length !== 3 ||
      !Array.isArray(heroCards) || heroCards.length !== 2 ||
      !actionToHero || typeof actionToHero.type !== 'string'
    ) {
      console.warn(`Batch ${batchIndex} item ${i} skipped: invalid shape`);
      continue;
    }
    const street = (o.street as string) ?? 'flop';
    rows.push({
      game: (o.game as string) ?? 'NLH',
      hero_pos: String(o.hero_pos ?? 'BTN'),
      villain_pos: String(o.villain_pos ?? 'BB'),
      effective_stack_bb: Number(o.effective_stack_bb ?? 100),
      hero_cards: [String(heroCards[0]), String(heroCards[1])],
      board: {
        flop: [String(flop[0]), String(flop[1]), String(flop[2])],
        turn: board?.turn != null ? String(board.turn) : null,
        river: board?.river != null ? String(board.river) : null,
      },
      pot_bb: Number(o.pot_bb ?? 0),
      street: street === 'turn' ? 'turn' : street === 'river' ? 'river' : 'flop',
      action_to_hero: {
        type: (actionToHero.type === 'bet' || actionToHero.type === 'raise' ? actionToHero.type : 'check') as 'bet' | 'check' | 'raise',
        size_bb: Number(actionToHero.size_bb ?? 0),
      },
      correct_action: (o.correct_action === 'fold' || o.correct_action === 'call' || o.correct_action === 'raise'
        ? o.correct_action
        : 'call') as 'fold' | 'call' | 'raise',
      explanation: String(o.explanation ?? ''),
      drill_type: 'action_decision',
    });
  }
  return rows;
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let inserted = 0;

  const numBatches = Math.ceil(FIRST_BATCH_TARGET / BATCH_SIZE);
  console.log(`Generating first batch: ${FIRST_BATCH_TARGET} tasks (${numBatches} x ${BATCH_SIZE})...\n`);

  for (let b = 0; b < numBatches; b++) {
    try {
      const rows = await generateBatch(b);
      if (rows.length === 0) {
        console.warn(`Batch ${b + 1}/${numBatches}: no valid rows, retry?`);
        continue;
      }
      const toInsert = rows.map((r) => ({
        game: r.game,
        hero_pos: r.hero_pos,
        villain_pos: r.villain_pos,
        effective_stack_bb: r.effective_stack_bb,
        hero_cards: r.hero_cards,
        board: r.board,
        pot_bb: r.pot_bb,
        street: r.street,
        action_to_hero: r.action_to_hero,
        correct_action: r.correct_action,
        explanation: r.explanation,
        drill_type: r.drill_type ?? 'action_decision',
      }));
      const { error } = await supabase.from('hand_library').insert(toInsert);
      if (error) {
        console.error(`Batch ${b + 1} insert error:`, error.message);
        continue;
      }
      inserted += toInsert.length;
      console.log(`Batch ${b + 1}/${numBatches}: inserted ${toInsert.length} (total ${inserted})`);
    } catch (e) {
      console.error(`Batch ${b + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone. Inserted ${inserted} tasks into hand_library.`);
  if (inserted >= FIRST_BATCH_TARGET) {
    console.log('Первая сотня готова. Можно повторить цикл до 3000.');
  }
}

main().catch(console.error);
