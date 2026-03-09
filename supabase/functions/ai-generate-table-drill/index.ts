import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const POSITIONS = ['BTN', 'SB', 'BB', 'CO', 'HJ', 'UTG', 'MP'] as const;
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['s', 'h', 'd', 'c'];

type DrillType = 'action_decision' | 'raise_sizing';

type GenerateDrillRequest = {
  leak_tag?: string;
  drill_type?: DrillType;
};

type Difficulty = 'easy' | 'medium' | 'hard';

/** Compute difficulty from skill_rating. Priority: long no-practice > rating/streak. */
function computeDifficulty(
  rating: number,
  streakCorrect: number,
  lastPracticeAt: string | null
): Difficulty {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // First exposure: no record yet
  if (lastPracticeAt == null) return 'medium';

  const last = new Date(lastPracticeAt);
  // Long time no practice: priority over rating >= 70 hard
  if (last < fourteenDaysAgo) return rating <= 40 ? 'easy' : 'medium';

  if (rating <= 40) return 'easy';
  if (rating >= 70 && streakCorrect >= 3) return 'hard';
  return 'medium';
}

type TableDrillScenarioAction = {
  game: string;
  hero_pos: string;
  villain_pos: string;
  effective_stack_bb: number;
  hero_cards: [string, string];
  board: { flop: [string, string, string]; turn: string | null; river: string | null };
  pot_bb: number;
  street: string;
  action_to_hero: { type: 'bet' | 'check' | 'raise'; size_bb: number };
  correct_action: 'fold' | 'call' | 'raise';
  explanation: string;
};

type TableDrillScenarioRaiseSizing = Omit<TableDrillScenarioAction, 'correct_action'> & {
  drill_type: 'raise_sizing';
  options: [string, string, string];
  correct_option: string;
  rule_of_thumb: string;
  leak_tag: string;
};

type TableDrillScenario = TableDrillScenarioAction | (TableDrillScenarioRaiseSizing & { correct_action?: never });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseCard(s: string): { rank: string; suit: string } | null {
  if (typeof s !== 'string' || s.length < 2) return null;
  const rank = s[0].toUpperCase();
  const suit = s[s.length - 1].toLowerCase();
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) return null;
  return { rank, suit };
}

function cardKey(s: string): string {
  const p = parseCard(s);
  return p ? `${p.rank}${p.suit}` : '';
}

/** Ensure no duplicate cards across hero_cards and board */
function allCardsUnique(scenario: TableDrillScenarioAction): boolean {
  const allCards = [
    ...(scenario.hero_cards || []),
    ...(scenario.board?.flop || []),
    scenario.board?.turn,
    scenario.board?.river
  ].filter(Boolean);
  const set = new Set<string>();
  for (const c of allCards) {
    const k = cardKey(c);
    if (!k || set.has(k)) return false;
    set.add(k);
  }
  if (!Array.isArray(scenario.board?.flop) || scenario.board.flop.length !== 3) return false;
  return true;
}

/** Sizes reasonable vs stack (e.g. bet/raise <= stack, pot >= 0) */
function sizesReasonable(scenario: TableDrillScenarioAction): boolean {
  const stack = scenario.effective_stack_bb;
  if (stack <= 0 || stack > 500) return false;
  if (scenario.pot_bb < 0) return false;
  const size = scenario.action_to_hero.size_bb;
  if (size < 0) return false;
  if (scenario.action_to_hero.type !== 'check' && size > stack) return false;
  return true;
}

function positionsValid(scenario: TableDrillScenarioAction): boolean {
  return (
    POSITIONS.includes(scenario.hero_pos as any) &&
    POSITIONS.includes(scenario.villain_pos as any)
  );
}

// ─── Hand rank evaluator (no GPT — we decide the combination) ───
const RANK_VALUES: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

type CardObj = { rank: string; suit: string; value: number };

function getCardsForStreet(
  heroCards: string[],
  board: { flop: string[]; turn: string | null; river: string | null },
  street: string
): CardObj[] {
  const out: CardObj[] = [];
  for (const s of heroCards) {
    const p = parseCard(s);
    if (p) out.push({ rank: p.rank, suit: p.suit, value: RANK_VALUES[p.rank] ?? 0 });
  }
  const flop = board?.flop ?? [];
  for (const s of flop) {
    const p = parseCard(s);
    if (p) out.push({ rank: p.rank, suit: p.suit, value: RANK_VALUES[p.rank] ?? 0 });
  }
  if ((street === 'turn' || street === 'river') && board?.turn) {
    const p = parseCard(board.turn);
    if (p) out.push({ rank: p.rank, suit: p.suit, value: RANK_VALUES[p.rank] ?? 0 });
  }
  if (street === 'river' && board?.river) {
    const p = parseCard(board.river);
    if (p) out.push({ rank: p.rank, suit: p.suit, value: RANK_VALUES[p.rank] ?? 0 });
  }
  return out;
}

function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  const withH = combos(t, k - 1).map((c) => [h, ...c]);
  const without = combos(t, k);
  return [...withH, ...without];
}

function isFlush(cards: CardObj[]): boolean {
  const bySuit: Record<string, number> = {};
  for (const c of cards) {
    bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1;
  }
  return Math.max(...Object.values(bySuit)) >= 5;
}

function isStraight(cards: CardObj[]): boolean {
  const vals = [...new Set(cards.map((c) => c.value))];
  const withAceLow = vals.some((v) => v === 14) ? [...vals.filter((v) => v !== 14), 1] : vals;
  const all = [...new Set([...vals, ...withAceLow])].sort((a, b) => b - a);
  for (let i = 0; i <= all.length - 5; i++) {
    let consecutive = true;
    for (let j = 1; j < 5; j++) {
      if (all[i + j] !== all[i] - j) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) return true;
  }
  return false;
}

function rankCounts(cards: CardObj[]): number[] {
  const count: Record<number, number> = {};
  for (const c of cards) {
    count[c.value] = (count[c.value] ?? 0) + 1;
  }
  return Object.values(count).sort((a, b) => b - a);
}

function handRankName(cards: CardObj[]): string {
  if (cards.length !== 5) return 'High Card';
  const flush = isFlush(cards);
  const straight = isStraight(cards);
  if (flush && straight) return 'Straight Flush';
  const rc = rankCounts(cards);
  if (rc[0] === 4) return 'Quads';
  if (rc[0] === 3 && rc[1] === 2) return 'Full House';
  if (flush) return 'Flush';
  if (straight) return 'Straight';
  if (rc[0] === 3) return 'Set';
  if (rc[0] === 2 && rc[1] === 2) return 'Two Pair';
  if (rc[0] === 2) return 'Pair';
  return 'High Card';
}

/** Returns the best hand rank label for Hero on the given street. */
function evaluateHandRank(
  heroCards: string[],
  board: { flop: string[]; turn: string | null; river: string | null },
  street: string
): string {
  const cards = getCardsForStreet(heroCards, board, street);
  if (cards.length < 5) return 'High Card';
  const fiveCardCombos = combos(cards, 5);
  let best: string = 'High Card';
  const order = [
    'High Card',
    'Pair',
    'Two Pair',
    'Set',
    'Straight',
    'Flush',
    'Full House',
    'Quads',
    'Straight Flush',
  ];
  for (const combo of fiveCardCombos) {
    const name = handRankName(combo);
    if (order.indexOf(name) > order.indexOf(best)) best = name;
  }
  return best;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ ok: false }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);

    const body = (await req.json()) as GenerateDrillRequest;
    const validLeakTag = body.leak_tag ? enforceAllowedLeakTag(body.leak_tag) : null;
    const leak_tag = validLeakTag ?? 'fundamentals';
    const drillType: DrillType =
      body.drill_type === 'raise_sizing' ? 'raise_sizing' : 'action_decision';

    let difficulty: Difficulty = 'medium';
    if (validLeakTag) {
      const { data: row } = await supabaseUser
        .from('skill_ratings')
        .select('rating, streak_correct, last_practice_at')
        .eq('user_id', userId)
        .eq('leak_tag', validLeakTag)
        .maybeSingle();

      const rating = row?.rating ?? 50;
      const streak = row?.streak_correct ?? 0;
      const lastPracticeAt = row?.last_practice_at ?? null;
      difficulty = computeDifficulty(rating, streak, lastPracticeAt);
      console.log(
        JSON.stringify({
          leak_tag: validLeakTag,
          rating,
          streak,
          difficulty,
        })
      );
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ ok: false });
    }

    const model = 'gpt-4o';

    const RAISE_SIZING_OPTIONS = ['2.5x', '3x', 'overbet'] as const;

    if (drillType === 'raise_sizing') {
      const schemaRaiseSizing = {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          game: { type: 'string' },
          hero_pos: { type: 'string', enum: [...POSITIONS] },
          villain_pos: { type: 'string', enum: [...POSITIONS] },
          effective_stack_bb: { type: 'number' },
          hero_cards: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
          board: {
            type: 'object',
            additionalProperties: false,
            properties: {
              flop: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
              turn: { type: ['string', 'null'] },
              river: { type: ['string', 'null'] },
            },
            required: ['flop', 'turn', 'river'],
          },
          pot_bb: { type: 'number' },
          street: { type: 'string', enum: ['flop', 'turn', 'river'] },
          action_to_hero: {
            type: 'object',
            additionalProperties: false,
            properties: { type: { type: 'string', enum: ['bet', 'check', 'raise'] }, size_bb: { type: 'number' } },
            required: ['type', 'size_bb'],
          },
          drill_type: { type: 'string', enum: ['raise_sizing'] },
          options: { type: 'array', items: { type: 'string', enum: [...RAISE_SIZING_OPTIONS] }, minItems: 3, maxItems: 3 },
          correct_option: { type: 'string', enum: [...RAISE_SIZING_OPTIONS] },
          rule_of_thumb: { type: 'string' },
          leak_tag: { type: 'string' },
        },
        required: [
          'game', 'hero_pos', 'villain_pos', 'effective_stack_bb', 'hero_cards', 'board',
          'pot_bb', 'street', 'action_to_hero', 'drill_type', 'options', 'correct_option',
          'rule_of_thumb', 'leak_tag',
        ],
      };

      const difficultyGuidelinesRs: Record<Difficulty, string> = {
        easy: 'Очевидные решения по сайзингу, меньше смешанных линий.',
        medium: 'Стандартные споты, иногда близкие решения по размеру рейза.',
        hard: 'Тонкие решения по сайзингу, давление стеков/поляризация.',
      };

      const systemPromptRsScenario = `ТЫ — ГЕНЕРАТОР СЦЕНАРИЕВ RAISE SIZING. Верни сценарий с полями game, hero_pos, villain_pos, effective_stack_bb, hero_cards, board, pot_bb, street, action_to_hero, drill_type, options, correct_option, rule_of_thumb, leak_tag. Поле explanation НЕ заполняй — его заполнит следующий шаг.

Карты в формате "Ah", "Ts". Все карты УНИКАЛЬНЫ. Сложность: ${difficulty.toUpperCase()} — ${difficultyGuidelinesRs[difficulty]}. leak_tag = "${leak_tag}". options = ["2.5x", "3x", "overbet"]. Верни ТОЛЬКО JSON по схеме.`;

      const openaiResRs = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPromptRsScenario },
            { role: 'user', content: 'Сгенерируй сценарий raise sizing' },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'table_drill_raise_sizing',
              schema: schemaRaiseSizing,
              strict: true,
            },
          },
          user: userId,
        }),
      });

      if (!openaiResRs.ok) {
        const errText = await openaiResRs.text();
        console.error('OpenAI error (raise_sizing scenario):', errText);
        return json({ ok: false });
      }

      const payloadRs = await openaiResRs.json();
      const textRs = payloadRs.choices?.[0]?.message?.content ?? '';
      if (!textRs) return json({ ok: false });

      let scenarioRs: Record<string, unknown>;
      try {
        scenarioRs = JSON.parse(textRs);
      } catch {
        return json({ ok: false });
      }

      if (
        !Array.isArray(scenarioRs.hero_cards) ||
        scenarioRs.hero_cards.length !== 2 ||
        !Array.isArray(scenarioRs.board?.flop) ||
        scenarioRs.board.flop.length !== 3
      ) {
        return json({ ok: false });
      }

      const options = scenarioRs.options as unknown;
      const correctOption = scenarioRs.correct_option as string;
      if (
        !Array.isArray(options) ||
        options.length !== 3 ||
        !RAISE_SIZING_OPTIONS.includes(correctOption as any) ||
        !options.includes(correctOption)
      ) {
        return json({ ok: false });
      }

      if (!allCardsUnique(scenarioRs as TableDrillScenarioAction) || !sizesReasonable(scenarioRs as TableDrillScenarioAction) || !positionsValid(scenarioRs as TableDrillScenarioAction)) {
        return json({ ok: false });
      }

      const hand_rank_rs = evaluateHandRank(
        scenarioRs.hero_cards as string[],
        scenarioRs.board as TableDrillScenarioAction['board'],
        (scenarioRs.street as string) ?? 'flop'
      );

      const streetLabelRs = (scenarioRs.street as string) === 'flop' ? 'флоп' : (scenarioRs.street as string) === 'turn' ? 'терн' : 'ривер';
      const schemaExplRs = {
        type: 'object' as const,
        additionalProperties: false,
        properties: { explanation: { type: 'string' } },
        required: ['explanation'],
      };
      const systemPromptRsExpl = `ТЫ — ГОЛОС СОЛВЕРА. ТЕБЕ ЗАПРЕЩЕНО ОПРЕДЕЛЯТЬ КОМБИНАЦИЮ САМОСТОЯТЕЛЬНО.

МЫ ДАЕМ ТЕБЕ ФАКТ: У игрока (Hero) комбинация: ${hand_rank_rs}. Твоя задача — объяснить стратегию по сайзингу рейза, исходя ТОЛЬКО из этого ФАКТА.

КРИТИЧЕСКОЕ ПРАВИЛО: Готовый стрит/флеш/сет — это УЖЕ УЧТЕНО в факте "${hand_rank_rs}". НИКОГДА не называй готовую руку «дро». ЕСЛИ НАПИШЕШЬ «ДРО» ПРИ ГОТОВОМ СТРИТЕ/ФЛЕШЕ/СЕТЕ — ГРУБАЯ ОШИБКА.

ЗАПРЕЩЕНО: Если в факте указан стрит или флеш — объяснение должно строиться вокруг стрита/флеша. Не пиши про «две пары» или «защиту пары», когда комбинация Hero — стрит или флеш.

АНАЛИЗИРУЙ ТОЛЬКО ТЕКУЩУЮ УЛИЦУ: ${streetLabelRs}. НИКАКОГО флопа на терне. В explanation: Pot Odds в %, эквити, блокеры, SPR, MDF, почему выбранный сайзинг верный или нет. Минимум 3–4 предложения. Русский язык.`;

      const userContentRsExpl = `Сценарий:
${JSON.stringify({
  hero_pos: scenarioRs.hero_pos,
  villain_pos: scenarioRs.villain_pos,
  hero_cards: scenarioRs.hero_cards,
  board: scenarioRs.board,
  street: scenarioRs.street,
  pot_bb: scenarioRs.pot_bb,
  action_to_hero: scenarioRs.action_to_hero,
  options: scenarioRs.options,
  correct_option: scenarioRs.correct_option,
})}

Напиши только поле explanation для raise sizing, исходя из факта: у Hero комбинация "${hand_rank_rs}".`;

      const openaiResRsExpl = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPromptRsExpl },
            { role: 'user', content: userContentRsExpl },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'explanation_rs', schema: schemaExplRs, strict: true },
          },
          user: userId,
        }),
      });

      if (!openaiResRsExpl.ok) {
        const errText = await openaiResRsExpl.text();
        console.error('OpenAI error (raise_sizing explanation):', errText);
        return json({ ok: false });
      }

      const payloadRsExpl = await openaiResRsExpl.json();
      const textRsExpl = payloadRsExpl.choices?.[0]?.message?.content ?? '';
      let explRs: { explanation: string };
      try {
        explRs = JSON.parse(textRsExpl);
      } catch {
        return json({ ok: false });
      }

      (scenarioRs as Record<string, unknown>).leak_tag = leak_tag;
      (scenarioRs as Record<string, unknown>).explanation = explRs.explanation ?? '';

      return json({
        ok: true,
        scenario: { ...scenarioRs, drill_type: 'raise_sizing' as const },
        difficulty,
      });
    }

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        game: { type: 'string' },
        hero_pos: { type: 'string', enum: POSITIONS },
        villain_pos: { type: 'string', enum: POSITIONS },
        effective_stack_bb: { type: 'number' },
        hero_cards: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 2,
        },
        board: {
          type: 'object',
          additionalProperties: false,
          properties: {
            flop: {
              type: 'array',
              items: { type: 'string' },
              minItems: 3,
              maxItems: 3,
            },
            turn: { type: ['string', 'null'] },
            river: { type: ['string', 'null'] },
          },
          required: ['flop', 'turn', 'river'],
        },
        pot_bb: { type: 'number' },
        street: { type: 'string', enum: ['flop', 'turn', 'river'] },
        action_to_hero: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['bet', 'check', 'raise'] },
            size_bb: { type: 'number' },
          },
          required: ['type', 'size_bb'],
        },
        correct_action: { type: 'string', enum: ['fold', 'call', 'raise'] },
      },
      required: [
        'game',
        'hero_pos',
        'villain_pos',
        'effective_stack_bb',
        'hero_cards',
        'board',
        'pot_bb',
        'street',
        'action_to_hero',
        'correct_action',
      ],
    };

    const difficultyGuidelines: Record<Difficulty, string> = {
      easy:
        'Очевидные решения, меньше смешанных/маргинальных линий, без knife-edge спотов.',
      medium: 'Стандартные споты, иногда близкие решения.',
      hard: 'Тонкие решения, давление стеков/сайзингов/поляризация, без рандома.',
    };

    const systemPromptScenario = `ТЫ — ГЕНЕРАТОР СЦЕНАРИЕВ ДЛЯ ПОКЕРНОГО ДРИЛЛА. Твоя задача — вернуть ТОЛЬКО данные сценария (карты, борд, улица, действие оппонента, правильное действие). Поле explanation ты НЕ заполняешь — его заполнит другой шаг.

ЯЗЫК полей: как в схеме. Карты в формате "Ah", "Ts" и т.д. Все карты в hero_cards и board УНИКАЛЬНЫ.

Сложность: ${difficulty.toUpperCase()} — ${difficultyGuidelines[difficulty]}

ТЕХНИЧЕСКИЕ ПРАВИЛА: game = "NLH"; hero_pos, villain_pos из: BTN, SB, BB, CO, HJ, UTG, MP; effective_stack_bb 20–200; correct_action: fold | call | raise. Верни ТОЛЬКО JSON по схеме (без поля explanation). ФОКУС (leak_tag): ${leak_tag}.`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPromptScenario },
          { role: 'user', content: 'Сгенерируй сценарий' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'table_drill_scenario',
            schema,
            strict: true,
          },
        },
        user: userId,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error (scenario):', errText);
      return json({ ok: false });
    }

    const payload = await openaiRes.json();
    const text = payload.choices?.[0]?.message?.content ?? '';

    if (!text) {
      return json({ ok: false });
    }

    let scenarioRaw: Record<string, unknown>;
    try {
      scenarioRaw = JSON.parse(text);
    } catch {
      return json({ ok: false });
    }

    if (
      !Array.isArray(scenarioRaw.hero_cards) ||
      scenarioRaw.hero_cards.length !== 2 ||
      !Array.isArray((scenarioRaw.board as any)?.flop) ||
      (scenarioRaw.board as any).flop.length !== 3
    ) {
      return json({ ok: false });
    }

    if (
      !allCardsUnique(scenarioRaw as TableDrillScenarioAction) ||
      !sizesReasonable(scenarioRaw as TableDrillScenarioAction) ||
      !positionsValid(scenarioRaw as TableDrillScenarioAction)
    ) {
      return json({ ok: false });
    }

    const hand_rank = evaluateHandRank(
      scenarioRaw.hero_cards as string[],
      scenarioRaw.board as TableDrillScenarioAction['board'],
      (scenarioRaw.street as string) ?? 'flop'
    );

    const schemaExplanation = {
      type: 'object' as const,
      additionalProperties: false,
      properties: { explanation: { type: 'string' } },
      required: ['explanation'],
    };

    const streetLabel = (scenarioRaw.street as string) === 'flop' ? 'флоп' : (scenarioRaw.street as string) === 'turn' ? 'терн' : 'ривер';
    const systemPromptExplanation = `ТЫ — ГОЛОС СОЛВЕРА. ТЕБЕ ЗАПРЕЩЕНО ОПРЕДЕЛЯТЬ КОМБИНАЦИЮ САМОСТОЯТЕЛЬНО.

МЫ ДАЕМ ТЕБЕ ФАКТ: У игрока (Hero) комбинация: ${hand_rank}. Твоя задача — объяснить стратегию, исходя ТОЛЬКО из этого ФАКТА.

КРИТИЧЕСКОЕ ПРАВИЛО: Если у игрока готовый стрит, флеш, сет и т.д. — это УЖЕ УЧТЕНО в факте "${hand_rank}". НИКОГДА не называй готовую руку «дро» или «стрит-дро», когда факт говорит о готовой комбинации. ЕСЛИ ТЫ НАПИШЕШЬ «ДРО», КОГДА У ИГРОКА СТРИТ/ФЛЕШ/СЕТ — ЭТО ГРУБАЯ ОШИБКА.

ЗАПРЕЩЕНО: Если в факте указан стрит или флеш — объяснение должно строиться вокруг стрита/флеша. Не пиши про «две пары» или «защиту пары», когда комбинация Hero — стрит или флеш.

АНАЛИЗИРУЙ ТОЛЬКО ТЕКУЩУЮ УЛИЦУ: ${streetLabel} (street = "${scenarioRaw.street}"). НИКАКОГО флопа на терне, никакого терна на ривере. Explanation должен относиться только к действию на этой улице.

В explanation: Pot Odds в %, эквити, позиции hero_pos и villain_pos, почему correct_action верный или неверный. Минимум 3–4 предложения. Язык: русский.`;

    const userContentExplanation = `Сценарий:
${JSON.stringify({
  hero_pos: scenarioRaw.hero_pos,
  villain_pos: scenarioRaw.villain_pos,
  hero_cards: scenarioRaw.hero_cards,
  board: scenarioRaw.board,
  street: scenarioRaw.street,
  pot_bb: scenarioRaw.pot_bb,
  action_to_hero: scenarioRaw.action_to_hero,
  correct_action: scenarioRaw.correct_action,
})}

Напиши только поле explanation (объяснение стратегии для Hero), исходя из факта: у Hero комбинация "${hand_rank}".`;

    const openaiResExpl = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPromptExplanation },
          { role: 'user', content: userContentExplanation },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'explanation_only',
            schema: schemaExplanation,
            strict: true,
          },
        },
        user: userId,
      }),
    });

    if (!openaiResExpl.ok) {
      const errText = await openaiResExpl.text();
      console.error('OpenAI error (explanation):', errText);
      return json({ ok: false });
    }

    const payloadExpl = await openaiResExpl.json();
    const textExpl = payloadExpl.choices?.[0]?.message?.content ?? '';
    let explanationObj: { explanation: string };
    try {
      explanationObj = JSON.parse(textExpl);
    } catch {
      return json({ ok: false });
    }

    const scenario: TableDrillScenario = {
      ...scenarioRaw,
      explanation: explanationObj.explanation ?? '',
      drill_type: 'action_decision',
    } as TableDrillScenario;
    return json({ ok: true, scenario, difficulty });
  } catch (e) {
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    return json({ ok: false }, 500);
  }
});
