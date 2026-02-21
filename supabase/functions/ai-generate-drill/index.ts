import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type CoachStyle = 'TOXIC' | 'MENTAL' | 'MATH';

type GenerateDrillRequest = {
  coach_style: CoachStyle;
  leak_tag?: string;
};

type TopLeak = {
  tag: string;
  count: number;
  explanation: string;
};

type DrillOption = {
  key: 'A' | 'B' | 'C';
  text: string;
};

type DrillScenario = {
  id: string;
  title: string;
  spot: string;
  question: string;
  options: DrillOption[];
  correct: 'A' | 'B' | 'C';
  mistake_tag: string;
  explanation: string;
  focus_leak: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getLatestLeakSummary(supabase: any, userId: string): Promise<TopLeak[]> {
  try {
    const { data, error } = await supabase
      .from('leak_summaries')
      .select('summary')
      .eq('user_id', userId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return [];
    const summary = data.summary;
    if (!summary || !Array.isArray(summary.top_leaks)) return [];
    return summary.top_leaks;
  } catch {
    return [];
  }
}

function selectFocusLeak(topLeaks: TopLeak[], explicitLeakTag?: string | null): string | null {
  if (explicitLeakTag) {
    const normalized = enforceAllowedLeakTag(explicitLeakTag);
    return normalized ?? null;
  }
  if (topLeaks.length === 0) return null;
  if (Math.random() < 0.7) return topLeaks[0].tag;
  const poolSize = Math.min(3, topLeaks.length);
  return topLeaks[Math.floor(Math.random() * poolSize)].tag;
}

function buildSystemPrompt(style: CoachStyle, focusLeak: string | null, topLeaks: TopLeak[]): string {
  const toneRules = {
    TOXIC: 'Жёсткий профессиональный рег: коротко, саркастично, но без оскорблений личности.',
    MENTAL: 'Поддерживающий ментальный тренер: спокойно, уверенно, мотивирующе.',
    MATH: 'Математичный GTO-аналитик: сухо, точно, по делу.',
  };
  const tone = toneRules[style];
  let leakContext = '';
  if (focusLeak) {
    const leakData = topLeaks.find((l) => l.tag === focusLeak);
    const count = leakData?.count ?? 0;
    leakContext = `\n\nФОКУС: Создай drill, который тренирует leak: "${focusLeak}"${count > 0 ? ` (${count} случаев)` : ''}.
- focus_leak должен быть = "${focusLeak}"
- mistake_tag также = "${focusLeak}"
- Сценарий должен тренировать именно эту ошибку
- Правильный ответ должен корректировать эту ошибку`;
  } else {
    leakContext = `\n\nФОКУС: У игрока нет данных по ошибкам. Создай общий drill по базовым принципам:
- focus_leak = null
- mistake_tag = "fundamentals"`;
  }
  return `Ты — тренер по покеру. Стиль: ${tone}${leakContext}

ЗАДАЧА: Создай ОДИН короткий тренировочный drill (A/B/C).

ПРАВИЛА:
1. title — короткий заголовок (3-7 слов)
2. spot — краткое описание ситуации (1 предложение: позиция, стек, борд)
3. question — конкретный вопрос "Что делать?"
4. options — 3 варианта: A, B, C (каждый text — 3-5 слов)
5. correct — правильный вариант (A/B/C)
6. mistake_tag — тег ошибки (если есть focus_leak, используй его)
7. explanation — почему правильный ответ верный (2-3 предложения)
8. focus_leak — заполни как указано выше

ВАЖНО:
- Drill должен быть коротким и понятным
- Без "портянок", только суть
- Вопрос должен иметь однозначно правильный ответ
- Все тексты на русском`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);

    const body = (await req.json()) as GenerateDrillRequest;
    if (!body.coach_style) {
      return json({ error: 'Missing required field: coach_style' }, 400);
    }
    const coach_style = body.coach_style;
    const explicitLeakTag = body.leak_tag ? enforceAllowedLeakTag(body.leak_tag) : null;

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    let topLeaks: TopLeak[] = [];
    try {
      topLeaks = await getLatestLeakSummary(supabaseUser, userId);
    } catch {
      // ignore
    }
    const focusLeak = selectFocusLeak(topLeaks, explicitLeakTag);
    const systemPrompt = buildSystemPrompt(coach_style, focusLeak, topLeaks);

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        spot: { type: 'string' },
        question: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', enum: ['A', 'B', 'C'] },
              text: { type: 'string' },
            },
            required: ['key', 'text'],
          },
          minItems: 3,
          maxItems: 3,
        },
        correct: { type: 'string', enum: ['A', 'B', 'C'] },
        mistake_tag: { type: 'string' },
        explanation: { type: 'string' },
        focus_leak: { type: ['string', 'null'] },
      },
      required: [
        'id',
        'title',
        'spot',
        'question',
        'options',
        'correct',
        'mistake_tag',
        'explanation',
        'focus_leak',
      ],
    };

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
          { role: 'user', content: 'Создай drill-сценарий' },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'drill_scenario',
            schema,
            strict: true,
          },
        },
        metadata: { user_id: userId, coach_style },
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return json({ error: 'OpenAI request failed', detail: errText }, 502);
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
      return json({ error: 'OpenAI returned empty response' }, 502);
    }

    let scenario: DrillScenario;
    try {
      scenario = JSON.parse(text);
    } catch {
      return json({ error: 'Failed to parse OpenAI response as JSON', detail: text }, 500);
    }

    scenario.focus_leak = enforceAllowedLeakTag(scenario.focus_leak) ?? null;
    scenario.mistake_tag = enforceAllowedLeakTag(scenario.mistake_tag) ?? 'fundamentals';
    if (!scenario.focus_leak) {
      scenario.mistake_tag = 'fundamentals';
    }

    return json(scenario);
  } catch (e) {
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
