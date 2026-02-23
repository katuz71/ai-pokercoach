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
  const set = new Set<string>();
  for (const c of scenario.hero_cards) {
    const k = cardKey(c);
    if (!k || set.has(k)) return false;
    set.add(k);
  }
  const flop = scenario.board.flop;
  if (!Array.isArray(flop) || flop.length !== 3) return false;
  for (const c of flop) {
    const k = cardKey(c);
    if (!k || set.has(k)) return false;
    set.add(k);
  }
  if (scenario.board.turn) {
    const k = cardKey(scenario.board.turn);
    if (!k || set.has(k)) return false;
    set.add(k);
  }
  if (scenario.board.river) {
    const k = cardKey(scenario.board.river);
    if (!k || set.has(k)) return false;
    set.add(k);
  }
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

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

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
          explanation: { type: 'string' },
          rule_of_thumb: { type: 'string' },
          leak_tag: { type: 'string' },
        },
        required: [
          'game', 'hero_pos', 'villain_pos', 'effective_stack_bb', 'hero_cards', 'board',
          'pot_bb', 'street', 'action_to_hero', 'drill_type', 'options', 'correct_option',
          'explanation', 'rule_of_thumb', 'leak_tag',
        ],
      };

      const difficultyGuidelinesRs: Record<Difficulty, string> = {
        easy: 'Очевидные решения по сайзингу, меньше смешанных линий.',
        medium: 'Стандартные споты, иногда близкие решения по размеру рейза.',
        hard: 'Тонкие решения по сайзингу, давление стеков/поляризация.',
      };

      const systemPromptRs = `Ты — тренер по покеру. Генерируй ОДИН реалистичный drill-сценарий RAISE SIZING: ситуация на столе (карты, борд, стек, действие противника), герой рейзит — нужно выбрать размер: 2.5x, 3x или overbet.

Generate a drill at difficulty: ${difficulty}.
${difficulty.toUpperCase()} — ${difficultyGuidelinesRs[difficulty]}

ПРАВИЛА:
- game = "NLH"
- hero_pos, villain_pos — из: BTN, SB, BB, CO, HJ, UTG, MP
- effective_stack_bb — от 20 до 200 BB
- hero_cards — ровно 2 карты в формате "Rs". Пример: ["As","Kd"]
- board.flop — 3 карты; turn и river — в зависимости от street
- street = "flop"|"turn"|"river"
- pot_bb — размер пота в BB
- action_to_hero: type = "bet" или "raise", size_bb — ставка противника в BB (герой выбирает размер рейза)
- drill_type = "raise_sizing"
- options = ["2.5x", "3x", "overbet"] — ровно в таком порядке
- correct_option — одно из: "2.5x", "3x", "overbet"
- explanation — краткое объяснение на русском (2-4 предложения)
- rule_of_thumb — короткое правило (одна фраза)
- leak_tag = "${leak_tag}" (строго это значение)

ВАЖНО: Все карты без дубликатов. Ответь ТОЛЬКО валидным JSON по схеме.`;

      const openaiResRs = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: systemPromptRs },
            { role: 'user', content: 'Сгенерируй сценарий raise sizing' },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'table_drill_raise_sizing',
              schema: schemaRaiseSizing,
              strict: true,
            },
          },
          metadata: { user_id: userId },
        }),
      });

      if (!openaiResRs.ok) {
        const errText = await openaiResRs.text();
        console.error('OpenAI error (raise_sizing):', errText);
        return json({ ok: false });
      }

      const payloadRs = await openaiResRs.json();
      let textRs = '';
      const outputRs = payloadRs.output ?? [];
      for (const item of outputRs) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.type === 'output_text' && typeof c.text === 'string') textRs += c.text;
          }
        }
      }
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

      (scenarioRs as Record<string, unknown>).leak_tag = leak_tag;

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
        explanation: { type: 'string' },
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
        'explanation',
      ],
    };

    const difficultyGuidelines: Record<Difficulty, string> = {
      easy:
        'Очевидные решения, меньше смешанных/маргинальных линий, без knife-edge спотов.',
      medium: 'Стандартные споты, иногда близкие решения.',
      hard: 'Тонкие решения, давление стеков/сайзингов/поляризация, без рандома.',
    };

    const systemPrompt = `Ты — тренер по покеру. Генерируй ОДИН реалистичный drill-сценарий для стола (карты, борд, стек, действие противника).

Generate a drill at difficulty: ${difficulty}.
${difficulty.toUpperCase()} — ${difficultyGuidelines[difficulty]}

ПРАВИЛА:
- game = "NLH"
- hero_pos, villain_pos — только из: BTN, SB, BB, CO, HJ, UTG, MP
- effective_stack_bb — от 20 до 200 BB
- hero_cards — ровно 2 карты в формате "Rs" (R = A,K,Q,J,T,9..2; s = s,h,d,c). Пример: ["As","Kd"]
- board.flop — ровно 3 карты; turn и river — одна карта или null в зависимости от street
- street = "flop" → turn и river = null; "turn" → только turn заполнен, river = null; "river" → оба заполнены
- pot_bb — размер пот в BB (реалистично)
- action_to_hero: type = "bet" | "check" | "raise", size_bb — размер в BB (для check можно 0)
- correct_action — "fold" | "call" | "raise"
- explanation — краткое объяснение на русском (2-4 предложения)

ФОКУС ОШИБКИ (leak_tag): ${leak_tag}. Сценарий должен тренировать именно эту тему.

ВАЖНО: Все карты без дубликатов. Размеры ставок не больше эффективного стека. Ответь ТОЛЬКО валидным JSON по схеме, без текста до или после.`;

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Сгенерируй сценарий' },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'table_drill_scenario',
            schema,
            strict: true,
          },
        },
        metadata: { user_id: userId },
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', errText);
      return json({ ok: false });
    }

    const payload = await openaiRes.json();
    let text = '';
    const output = payload.output ?? [];
    for (const item of output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' && typeof c.text === 'string') {
            text += c.text;
          }
        }
      }
    }

    if (!text) {
      return json({ ok: false });
    }

    let scenario: TableDrillScenario;
    try {
      scenario = JSON.parse(text);
    } catch {
      return json({ ok: false });
    }

    if (
      !Array.isArray(scenario.hero_cards) ||
      scenario.hero_cards.length !== 2 ||
      !scenario.board?.flop ||
      scenario.board.flop.length !== 3
    ) {
      return json({ ok: false });
    }

    if (!allCardsUnique(scenario) || !sizesReasonable(scenario) || !positionsValid(scenario)) {
      return json({ ok: false });
    }

    (scenario as Record<string, unknown>).drill_type = 'action_decision';
    return json({ ok: true, scenario, difficulty });
  } catch (e) {
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    return json({ ok: false }, 500);
  }
});
