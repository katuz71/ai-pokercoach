import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type CoachStyle = 'TOXIC' | 'MENTAL' | 'MATH';

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

type GradeDrillRequest = {
  scenario: DrillScenario;
  user_action: 'A' | 'B' | 'C';
  coach_style: CoachStyle;
};

type DrillGradeResult = {
  is_correct: boolean;
  correct_action: 'A' | 'B' | 'C';
  feedback: string;
  why: string[];
  next_step: string;
  mistake_tag: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildSystemPrompt(style: CoachStyle): string {
  const toneRules = {
    TOXIC: 'Жёсткий профессиональный рег: коротко, саркастично, но без оскорблений личности. При ошибке - жёстко, но конструктивно. При верном ответе - признай, но без лишних восторгов.',
    MENTAL: 'Поддерживающий ментальный тренер: спокойно, мотивирующе. При ошибке - поддержи и объясни спокойно. При верном ответе - похвали и мотивируй дальше.',
    MATH: 'Математичный GTO-аналитик: сухо, точно, по делу. При ошибке - укажи на логическую ошибку. При верном ответе - подтверди правильность.',
  };

  const tone = toneRules[style];

  return `Ты — тренер по покеру. Стиль: ${tone}

ЗАДАЧА: Оценить ответ игрока на drill.

Тебе дан:
- scenario: сценарий с правильным ответом
- user_action: выбор игрока

ПРАВИЛА:
1. is_correct — true если user_action == scenario.correct
2. correct_action — правильный ответ (scenario.correct)
3. feedback — короткий вердикт (1-2 предложения) в стиле тренера
4. why — 2-4 пункта объяснения (почему правильный ответ верный / почему выбор игрока ошибочный)
5. next_step — одно конкретное действие для игрока (что делать дальше)
6. mistake_tag — если ошибка, то scenario.mistake_tag, иначе null

ВАЖНО:
- Короткий, ёмкий фидбек
- Без "портянок"
- Все тексты на русском`;
}

function buildUserPrompt(scenario: DrillScenario, userAction: string): string {
  return `Сценарий: ${scenario.title}
Спот: ${scenario.spot}
Вопрос: ${scenario.question}

Варианты:
A: ${scenario.options.find(o => o.key === 'A')?.text || ''}
B: ${scenario.options.find(o => o.key === 'B')?.text || ''}
C: ${scenario.options.find(o => o.key === 'C')?.text || ''}

Правильный ответ: ${scenario.correct}
Выбор игрока: ${userAction}

Объяснение правильного ответа: ${scenario.explanation}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // Authenticate user and get user-scoped client
    const { userId, supabaseUser } = await requireUserClient(req);

    // Parse request body
    const body = (await req.json()) as GradeDrillRequest;
    if (!body.scenario || !body.user_action || !body.coach_style) {
      return json({ error: 'Missing required fields: scenario, user_action, coach_style' }, 400);
    }

    // Get OpenAI API key
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    // Build prompts
    const systemPrompt = buildSystemPrompt(body.coach_style);
    const userPrompt = buildUserPrompt(body.scenario, body.user_action);

    // JSON Schema for grade result
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        is_correct: { type: 'boolean' },
        correct_action: { type: 'string', enum: ['A', 'B', 'C'] },
        feedback: { type: 'string' },
        why: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
        },
        next_step: { type: 'string' },
        mistake_tag: { type: ['string', 'null'] },
      },
      required: ['is_correct', 'correct_action', 'feedback', 'why', 'next_step', 'mistake_tag'],
    };

    // Call OpenAI Responses API
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
          { role: 'user', content: userPrompt },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'drill_grade_result',
            schema,
            strict: true,
          },
        },
        metadata: {
          user_id: userId,
          coach_style: body.coach_style,
        },
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return json({ error: 'OpenAI request failed', detail: errText }, 502);
    }

    const payload = await openaiRes.json();

    // Extract text from Responses API output
    const output = payload.output ?? [];
    let text = '';
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

    // Parse and validate JSON
    let result: DrillGradeResult;
    try {
      result = JSON.parse(text);
    } catch (e) {
      return json({ error: 'Failed to parse OpenAI response as JSON', detail: text }, 500);
    }

    // Enforce allowed leak tags whitelist
    result.mistake_tag = enforceAllowedLeakTag(result.mistake_tag);

    // Save to training_events
    try {
      await supabaseUser.from('training_events').insert({
        user_id: userId,
        scenario: body.scenario,
        user_action: body.user_action,
        correct_action: body.scenario.correct,
        mistake_tag: result.is_correct ? null : body.scenario.mistake_tag,
      });
    } catch (dbError) {
      console.error('Failed to save training event:', dbError);
      // Continue even if DB save fails
    }

    // Return grade result
    return json(result);
  } catch (e) {
    // Handle authentication errors
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
