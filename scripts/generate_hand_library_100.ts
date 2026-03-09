/**
 * Генерация первых 100 задач для hand_library: gpt-4o, распределение 30% флоп / 30% терн / 40% ривер.
 * GTO-анализ на русском (шансы банка, блокеры, SPR). Готовые руки (стрит, флеш, фулл-хаус) в explanation называются готовыми.
 * Валидация комбинаций через pokersolver — hero_hand_rank и начало explanation задаются только по решению солвера.
 * Запуск: npx tsx scripts/generate_hand_library_100.ts
 *
 * .env: OPENAI_API_KEY, EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-ignore — CommonJS модуль
const Hand = require('pokersolver').Hand;

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Ключи потерялись!");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const POSITIONS = ['BTN', 'SB', 'BB', 'CO', 'HJ', 'UTG', 'MP'];

/** Привести карту к формату pokersolver: ранг + масть в нижнем регистре, например 'Ad', 'Th', '7s'. */
function toPokersolverCard(s: string): string {
  if (!s || typeof s !== 'string') return '';
  const t = s.trim();
  if (t.length < 2) return '';
  const rank = t[0].toUpperCase();
  const suit = (t[t.length - 1] || '').toLowerCase();
  if (!['s', 'h', 'd', 'c'].includes(suit)) return '';
  return rank + suit;
}

/** Все карты на текущей улице: hero_cards + board до street включительно. */
function getCardsForStreet(
  heroCards: [string, string],
  board: { flop: [string, string, string]; turn: string | null; river: string | null },
  street: 'flop' | 'turn' | 'river'
): string[] {
  const hero = heroCards.map(toPokersolverCard).filter(Boolean);
  const flop = (board.flop || []).map(toPokersolverCard).filter(Boolean);
  const cards = [...hero, ...flop];
  if (street === 'turn' && board.turn) cards.push(toPokersolverCard(board.turn));
  if (street === 'river' && board.river) cards.push(toPokersolverCard(board.river));
  return cards;
}

/** Решить лучшую руку через pokersolver. Карты: минимум 5 (флоп) или до 7 (ривер). */
function solveHandRank(cards: string[]): string | null {
  const normalized = cards.map(toPokersolverCard).filter(Boolean);
  if (normalized.length < 5) return null;
  try {
    const solved = Hand.solve(normalized, 'standard');
    return solved?.name ?? null;
  } catch {
    return null;
  }
}

/** Только эти колонки есть в таблице hand_library (реальная схема). */
const HAND_LIBRARY_COLUMNS = [
  'street',
  'hero_cards',
  'villain_cards',
  'board',
  'hero_pos',
  'villain_pos',
  'pot_size',
  'villain_bet',
  'hero_stack',
  'correct_action',
  'raise_sizing',
  'explanation',
  'difficulty',
  'action_to_hero',
  'drill_type',
  'options',
  'min_raise',
  'max_raise',
  'effective_stack_bb',
  'hero_hand_rank',
  'pot_odds',
  'spr',
  'game',
  'villain_action',
  'pot_bb',
] as const;

function pickHandLibraryRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  console.log("До фильтрации:", Object.keys(row));
  row.hero_cards = Array.isArray(row.hero_cards) ? row.hero_cards : ['As', 'Ad'];
  row.villain_cards = Array.isArray(row.villain_cards) ? row.villain_cards : ['Ks', 'Kd'];
  row.board =
    Array.isArray(row.board) ? row.board : row.board && typeof row.board === 'object' ? row.board : [];
  if (row.board && typeof row.board === 'object' && !Array.isArray(row.board)) {
    const b = row.board as Record<string, unknown>;
    row.board = [
      ...(Array.isArray(b.flop) ? b.flop : []),
      ...(Array.isArray(b.turn) ? b.turn : b.turn != null && b.turn !== '' ? [b.turn] : []),
      ...(Array.isArray(b.river) ? b.river : b.river != null && b.river !== '' ? [b.river] : []),
    ].filter((card: unknown) => !!card && card !== 'null');
  }
  if (!Array.isArray(row.board)) {
    row.board = [];
  }
  console.log("Борд после сплющивания:", row.board);

  // Маппинг полей: *_bb -> целевое поле, если целевое пусто
  if (row.pot_bb != null && (row.pot_size === undefined || row.pot_size === null)) {
    row.pot_size = row.pot_bb;
  }
  if (row.villain_bet_bb != null && (row.villain_bet === undefined || row.villain_bet === null)) {
    row.villain_bet = row.villain_bet_bb;
  }
  if (row.hero_stack_bb != null && (row.hero_stack === undefined || row.hero_stack === null)) {
    row.hero_stack = row.hero_stack_bb;
  }

  // Страховка от NULL для NOT NULL колонок
  row.pot_size = (row.pot_size ?? row.pot_bb ?? 10) as number;
  row.villain_bet = (row.villain_bet ?? 0) as number;
  row.hero_stack = (row.hero_stack ?? 100) as number;
  row.hero_pos = (row.hero_pos || 'BTN') as string;
  row.villain_pos = (row.villain_pos || 'BB') as string;

  console.log("Сформирован pot_size:", row.pot_size);

  // correct_action: только fold | call | raise (lowercase). "check" → "call"
  const rawAction = String(row.correct_action ?? '').trim().toLowerCase();
  row.correct_action = (rawAction === 'check' ? 'call' : (rawAction === 'fold' || rawAction === 'raise' ? rawAction : 'call')) as string;
  row.pot_bb = row.pot_bb ?? 100;
  row.effective_stack_bb = row.effective_stack_bb ?? 1000;
  const out: Record<string, unknown> = {};
  for (const key of HAND_LIBRARY_COLUMNS) {
    if (key in row && row[key] !== undefined) {
      let val = row[key];
      if (key === 'game') val = String(val ?? '');
      if (key === 'hero_cards') val = Array.isArray(val) ? val : ['As', 'Ad'];
      if (key === 'villain_cards') val = Array.isArray(val) ? val : ['Ks', 'Kd'];
      if (key === 'board')
        val = Array.isArray(val) ? val : [];
      if (key === 'pot_size') val = Number(val ?? row.pot_bb ?? 10);
      if (key === 'villain_bet') val = Number(val ?? 0);
      if (key === 'hero_stack') val = Number(val ?? 100);
      if (key === 'hero_pos') val = String(val || 'BTN');
      if (key === 'villain_pos') val = String(val || 'BB');
      out[key] = val;
    }
  }
  // Дефолты для NOT NULL и обязательных полей (только колонки из схемы)
  out.hero_cards = Array.isArray(out.hero_cards) ? out.hero_cards : ['As', 'Ad'];
  out.villain_cards = Array.isArray(out.villain_cards) ? out.villain_cards : ['Ks', 'Kd'];
  out.board = Array.isArray(out.board) ? out.board : [];
  out.pot_size = Number(out.pot_size ?? out.pot_bb ?? 10);
  out.villain_bet = Number(out.villain_bet ?? 0);
  out.hero_stack = Number(out.hero_stack ?? 100);
  out.hero_pos = String(out.hero_pos || 'BTN');
  out.villain_pos = String(out.villain_pos || 'BB');
  out.correct_action = (() => {
    const raw = String(out.correct_action ?? '').trim().toLowerCase();
    if (raw === 'check') return 'call';
    if (raw === 'fold' || raw === 'raise') return raw;
    return 'call';
  })();
  out.pot_bb = out.pot_bb ?? 100;
  out.effective_stack_bb = out.effective_stack_bb ?? 1000;
  out.game = String(out.game ?? 'NLH');
  console.log("После фильтрации:", Object.keys(out));
  return out;
}

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
  hero_hand_rank: string;
  drill_type?: string;
  villain_cards?: [string, string];
};

function buildPrompt(street: 'flop' | 'turn' | 'river', count: number): string {
  const streetLabel = street === 'flop' ? 'флоп' : street === 'turn' ? 'терн' : 'ривер';
  const boardHint =
    street === 'flop'
      ? 'board: { flop: [карта1, карта2, карта3], turn: null, river: null }'
      : street === 'turn'
        ? 'board: { flop: [3 карты], turn: одна карта, river: null }'
        : 'board: { flop: [3 карты], turn: одна карта, river: одна карта }';

  return `Сгенерируй ровно ${count} уникальных покерных раздач (NLH) для таблицы hand_library.

УЛИЦА: только "${street}" (street: "${street}"). ${boardHint}

Для каждой раздачи:
1. Hero — разнообразные ситуации: топ-пара, две пары, сет, стрит, флеш, фулл-хаус, оверкарты, дро и т.д. Карты в формате "Ah", "Kd", "Ts" (ранг + масть s/h/d/c). Все карты в раздаче уникальны.
2. Позиции: hero_pos и villain_pos из списка: ${POSITIONS.join(', ')}.
3. effective_stack_bb: 20–200, pot_bb > 0.
4. action_to_hero: type "bet" | "check" | "raise", size_bb — число (если не check).
5. correct_action: только "fold" | "call" | "raise" (ни в коем случае не "check"; если правильный ход — чек, указывай "call").

КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ explanation (на русском, развёрнутый GTO-анализ):
- Если у Hero уже ГОТОВЫЙ стрит, флеш или фулл-хаус — в explanation ОБЯЗАТЕЛЬНО назови это готовой рукой ("У Hero стрит", "У Hero флеш", "У Hero фулл-хаус"). Никогда не называй готовую комбинацию "дро" или "стрит-дро".
- explanation — развёрнутый GTO-анализ: шансы банка (пот-оддсы), блокеры, SPR, позиция, почему correct_action верный. 4–6 предложений.
- explanation относится ТОЛЬКО к текущей улице (${streetLabel}): не упоминай другие улицы в тексте.

Верни ТОЛЬКО JSON-массив из ${count} объектов. Каждый объект: game, hero_pos, villain_pos, effective_stack_bb, hero_cards (массив из 2 строк), villain_cards (массив из 2 строк — ОБЯЗАТЕЛЬНО), board (flop, turn, river как указано выше), pot_bb, street ("${street}"), action_to_hero (type, size_bb), correct_action, hero_hand_rank (название лучшей комбинации Hero на этой улице по-английски: "High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"), explanation.
Без markdown, без комментариев — только массив JSON.`;
}

/** Только запрос к GPT и разбор JSON, без валидации комбинаций (для ретрая слота). */
async function fetchBatchFromGPT(
  street: 'flop' | 'turn' | 'river',
  count: number,
  batchLabel: string
): Promise<HandRow[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Ты генератор покерных сценариев с GTO-анализом. Отвечай только валидным JSON-массивом объектов без markdown. Готовые руки (стрит, флеш, фулл-хаус) всегда называй готовыми, не дро.\n\nКаждый объект ОБЯЗАН содержать массив \'villain_cards\' (2 карты, например [\'As\', \'Kh\']). Без этого задача бесполезна.\n\nНИКОГДА не используй \'check\' как correct_action. Если правильный ход — чек, пиши \'call\'.',
        },
        { role: 'user', content: buildPrompt(street, count) },
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
    throw new Error(`Invalid JSON from OpenAI: ${cleaned.slice(0, 300)}`);
  }
  if (!Array.isArray(arr)) throw new Error('OpenAI did not return an array');

  const rows: HandRow[] = [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i] as Record<string, unknown>;
    const board = o.board as Record<string, unknown> | undefined;
    const flop = board?.flop;
    const heroCardsRaw = o.hero_cards;
    const villainCardsRaw = o.villain_cards;
    const actionToHero = o.action_to_hero as Record<string, unknown> | undefined;
    if (
      !Array.isArray(flop) ||
      flop.length !== 3 ||
      !actionToHero ||
      typeof actionToHero.type !== 'string'
    ) {
      console.warn(`${batchLabel} item ${i} skipped: invalid shape`);
      continue;
    }
    const heroCards: [string, string] =
      Array.isArray(heroCardsRaw) && heroCardsRaw.length >= 2
        ? [String(heroCardsRaw[0]), String(heroCardsRaw[1])]
        : ['As', 'Ad'];
    const vCards: [string, string] =
      Array.isArray(villainCardsRaw) && villainCardsRaw.length >= 2
        ? [String(villainCardsRaw[0]), String(villainCardsRaw[1])]
        : ['Ks', 'Kd'];
    const rawCa = String(o.correct_action ?? '').trim().toLowerCase();
    const correctAction: 'fold' | 'call' | 'raise' = rawCa === 'check' ? 'call' : (rawCa === 'fold' || rawCa === 'raise' ? rawCa : 'call');
    const aiHeroHandRank = String(o.hero_hand_rank ?? '').trim();
    rows.push({
      game: (o.game as string) ?? 'NLH',
      hero_pos: String(o.hero_pos ?? 'BTN'),
      villain_pos: String(o.villain_pos ?? 'BB'),
      effective_stack_bb: Number(o.effective_stack_bb ?? 100),
      hero_cards: heroCards,
      villain_cards: vCards,
      board: {
        flop: [String(flop[0]), String(flop[1]), String(flop[2])],
        turn: board?.turn != null ? String(board.turn) : null,
        river: board?.river != null ? String(board.river) : null,
      },
      pot_bb: Number(o.pot_bb ?? 0),
      street,
      action_to_hero: {
        type: (actionToHero.type === 'bet' || actionToHero.type === 'raise' ? actionToHero.type : 'check') as
          | 'bet'
          | 'check'
          | 'raise',
        size_bb: Number(actionToHero.size_bb ?? 0),
      },
      correct_action: correctAction,
      explanation: String(o.explanation ?? ''),
      hero_hand_rank: aiHeroHandRank || 'High Card',
      drill_type: 'action_decision',
    });
  }
  return rows;
}

async function generateBatch(street: 'flop' | 'turn' | 'river', count: number, batchLabel: string): Promise<HandRow[]> {
  const rows = await fetchBatchFromGPT(street, count, batchLabel);

  // Валидация комбинаций через pokersolver: перезаписываем hero_hand_rank и начало explanation
  const MAX_RETRY_PER_SLOT = 2;
  const validatedRows: HandRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cards = getCardsForStreet(row.hero_cards, row.board, row.street);
    const actualRank = solveHandRank(cards);
    const rank = actualRank ?? 'High Card';

    const aiRankNorm = (row.hero_hand_rank || '').trim().replace(/\s+/g, ' ');
    const match =
      aiRankNorm === rank ||
      (rank === 'One Pair' && (aiRankNorm === 'Pair' || aiRankNorm === 'One Pair')) ||
      (rank === 'Three of a Kind' && (aiRankNorm === 'Set' || aiRankNorm === 'Three of a Kind'));

    if (!match && validatedRows.length < rows.length) {
      let replaced = false;
      for (let retry = 0; retry < MAX_RETRY_PER_SLOT; retry++) {
        const retryBatch = await fetchBatchFromGPT(street, 1, `${batchLabel} retry slot ${i}`);
        if (retryBatch.length > 0) {
          const r = retryBatch[0];
          const retryCards = getCardsForStreet(r.hero_cards, r.board, r.street);
          const retryRank = solveHandRank(retryCards) ?? 'High Card';
          r.hero_hand_rank = retryRank;
          r.explanation = `У Hero ${retryRank}. ${r.explanation || ''}`.trim();
          validatedRows.push(r);
          replaced = true;
          console.warn(`${batchLabel} slot ${i}: ИИ написал "${row.hero_hand_rank}", pokersolver: "${rank}". Заменён на повторно сгенерированную задачу.`);
          break;
        }
      }
      if (!replaced) {
        row.hero_hand_rank = rank;
        row.explanation = `У Hero ${rank}. ${row.explanation || ''}`.trim();
        validatedRows.push(row);
        console.warn(`${batchLabel} slot ${i}: ИИ написал "${row.hero_hand_rank}", pokersolver: "${rank}". Исправлено на значение солвера.`);
      }
    } else {
      row.hero_hand_rank = rank;
      row.explanation = `У Hero ${rank}. ${(row.explanation || '').trim()}`;
      validatedRows.push(row);
    }
  }

  return validatedRows;
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  let inserted = 0;

  // 30% flop = 30, 30% turn = 30, 40% river = 40
  const BATCH_SIZE = 10;
  const FLOP_BATCHES = 3;   // 30
  const TURN_BATCHES = 3;   // 30
  const RIVER_BATCHES = 4;  // 40

  console.log('Генерация 100 задач: 30 флоп, 30 терн, 40 ривер (gpt-4o)...\n');

  for (let b = 0; b < FLOP_BATCHES; b++) {
    try {
      const rows = await generateBatch('flop', BATCH_SIZE, `Flop batch ${b + 1}/${FLOP_BATCHES}`);
      if (rows.length === 0) {
        console.warn(`Flop batch ${b + 1}: no valid rows`);
        continue;
      }
      const toInsert = rows.map((r) =>
        pickHandLibraryRow({
          game: r.game,
          hero_pos: r.hero_pos,
          villain_pos: r.villain_pos,
          effective_stack_bb: r.effective_stack_bb,
          hero_cards: r.hero_cards,
          villain_cards: r.villain_cards,
          board: r.board,
          pot_bb: r.pot_bb,
          street: r.street,
          action_to_hero: r.action_to_hero,
          correct_action: r.correct_action,
          explanation: r.explanation,
          hero_hand_rank: r.hero_hand_rank,
          drill_type: r.drill_type ?? 'action_decision',
        })
      );
      const payload: Record<string, unknown>[] = toInsert;
      if (!payload || !Array.isArray(payload) || payload.length === 0) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: payload пуст или не массив!");
        return;
      }
      console.log("Отправляю в базу задач:", payload.length);
      console.log("ИТОГОВЫЙ PAYLOAD ПЕРЕД ВСТАВКОЙ:", JSON.stringify(payload).substring(0, 200));
      const { data, error } = await supabase.from('hand_library').insert(payload).select();
      if (error) throw error;
      inserted += toInsert.length;
      console.log(`Flop ${b + 1}/${FLOP_BATCHES}: вставлено ${toInsert.length} (всего ${inserted})`);
    } catch (e) {
      console.error(`Flop batch ${b + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  for (let b = 0; b < TURN_BATCHES; b++) {
    try {
      const rows = await generateBatch('turn', BATCH_SIZE, `Turn batch ${b + 1}/${TURN_BATCHES}`);
      if (rows.length === 0) {
        console.warn(`Turn batch ${b + 1}: no valid rows`);
        continue;
      }
      const toInsert = rows.map((r) =>
        pickHandLibraryRow({
          game: r.game,
          hero_pos: r.hero_pos,
          villain_pos: r.villain_pos,
          effective_stack_bb: r.effective_stack_bb,
          hero_cards: r.hero_cards,
          villain_cards: r.villain_cards,
          board: r.board,
          pot_bb: r.pot_bb,
          street: r.street,
          action_to_hero: r.action_to_hero,
          correct_action: r.correct_action,
          explanation: r.explanation,
          hero_hand_rank: r.hero_hand_rank,
          drill_type: r.drill_type ?? 'action_decision',
        })
      );
      const payload: Record<string, unknown>[] = toInsert;
      if (!payload || !Array.isArray(payload) || payload.length === 0) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: payload пуст или не массив!");
        return;
      }
      console.log('Отправляю в базу задач:', payload.length);
      console.log("ИТОГОВЫЙ PAYLOAD ПЕРЕД ВСТАВКОЙ:", JSON.stringify(payload).substring(0, 200));
      const { data, error } = await supabase.from('hand_library').insert(payload).select();
      if (error) throw error;
      inserted += toInsert.length;
      console.log(`Turn ${b + 1}/${TURN_BATCHES}: вставлено ${toInsert.length} (всего ${inserted})`);
    } catch (e) {
      console.error(`Turn batch ${b + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  for (let b = 0; b < RIVER_BATCHES; b++) {
    try {
      const rows = await generateBatch('river', BATCH_SIZE, `River batch ${b + 1}/${RIVER_BATCHES}`);
      if (rows.length === 0) {
        console.warn(`River batch ${b + 1}: no valid rows`);
        continue;
      }
      const toInsert = rows.map((r) =>
        pickHandLibraryRow({
          game: r.game,
          hero_pos: r.hero_pos,
          villain_pos: r.villain_pos,
          effective_stack_bb: r.effective_stack_bb,
          hero_cards: r.hero_cards,
          villain_cards: r.villain_cards,
          board: r.board,
          pot_bb: r.pot_bb,
          street: r.street,
          action_to_hero: r.action_to_hero,
          correct_action: r.correct_action,
          explanation: r.explanation,
          hero_hand_rank: r.hero_hand_rank,
          drill_type: r.drill_type ?? 'action_decision',
        })
      );
      const payload: Record<string, unknown>[] = toInsert;
      if (!payload || !Array.isArray(payload) || payload.length === 0) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: payload пуст или не массив!");
        return;
      }
      console.log('Отправляю в базу задач:', payload.length);
      console.log("ИТОГОВЫЙ PAYLOAD ПЕРЕД ВСТАВКОЙ:", JSON.stringify(payload).substring(0, 200));
      const { data, error } = await supabase.from('hand_library').insert(payload).select();
      if (error) throw error;
      inserted += toInsert.length;
      console.log(`River ${b + 1}/${RIVER_BATCHES}: вставлено ${toInsert.length} (всего ${inserted})`);
    } catch (e) {
      console.error(`River batch ${b + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log('\nГотово! В базе теперь ' + inserted + ' задач.');
}

main().catch(console.error);
