import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type TopLeak = {
  tag: string;
  count: number;
  explanation: string;
};

type LeakSummary = {
  top_leaks: TopLeak[];
  improvement_plan: string[];
};

type ActionPlanItemType = 'analyze' | 'drill' | 'checkin' | 'manual';

type ActionPlanItem = {
  id: string;
  text: string;
  done: boolean;
  type?: ActionPlanItemType;
};

type ActionPlanResponse = {
  plan_id: string;
  period_start: string;
  period_end: string;
  focus_tag: string;
  items: ActionPlanItem[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getTodayUTC(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getSevenDaysFromNow(): string {
  const now = new Date();
  now.setDate(now.getDate() + 6); // 7 days total (today + 6)
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
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

    // Fetch latest leak summary
    const { data: latestLeakSummary, error: leakError } = await supabaseUser
      .from('leak_summaries')
      .select('summary')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (leakError) {
      return json({ error: 'Failed to fetch leak summary', detail: leakError.message }, 500);
    }

    if (!latestLeakSummary?.summary) {
      return json({
        error: 'no_leaks_found',
        message: 'Сначала сгенерируй Coach Review для анализа ошибок',
      }, 400);
    }

    const summary = latestLeakSummary.summary as LeakSummary;
    
    if (!summary.top_leaks || summary.top_leaks.length === 0) {
      return json({
        error: 'no_leaks_found',
        message: 'Не найдено ошибок для создания плана',
      }, 400);
    }

    const topLeak = summary.top_leaks[0];
    const focusTag = topLeak.tag;

    // Get OpenAI API key
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    // Build prompt
    const systemPrompt = `Ты — персональный тренер по покеру. Создаёшь практичный план действий на 7 дней для исправления конкретной ошибки игрока.

Правила:
- Получаешь топ ошибку (leak tag) игрока
- Создаёшь 5 коротких, конкретных пунктов (1-2 предложения макс)
- Каждый пункт должен быть практичным и выполнимым
- Пиши на русском, просто и понятно
- Формат строго JSON по схеме`;

    const userPrompt = `Топ ошибка игрока:
Тег: ${focusTag}
Количество: ${topLeak.count}x
Объяснение: ${topLeak.explanation}

Создай план из 5 конкретных действий для исправления этой ошибки.`;

    // JSON Schema for strict output
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          minItems: 5,
          maxItems: 5,
        },
      },
      required: ['items'],
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
            name: 'action_plan',
            schema,
            strict: true,
          },
        },
        metadata: {
          user_id: userId,
          focus_tag: focusTag,
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
    let aiResponse: { items: string[] };
    try {
      aiResponse = JSON.parse(text);
    } catch (e) {
      return json({ error: 'Failed to parse OpenAI response as JSON', detail: text }, 500);
    }

    if (!Array.isArray(aiResponse.items) || aiResponse.items.length !== 5) {
      return json({ error: 'Invalid response schema from OpenAI', detail: aiResponse }, 500);
    }

    // Build action plan items with stable IDs
    // First 3 items get auto-trackable types (analyze, drill, checkin)
    // Remaining items are manual
    const autoTypes: ActionPlanItemType[] = ['analyze', 'drill', 'checkin'];
    const actionItems: ActionPlanItem[] = aiResponse.items.map((text, idx) => ({
      id: `day${idx + 1}`,
      text,
      done: false,
      type: idx < 3 ? autoTypes[idx] : 'manual',
    }));

    const periodStart = getTodayUTC();
    const periodEnd = getSevenDaysFromNow();

    // Save to action_plans (upsert to allow regeneration)
    const { data: insertData, error: insertError } = await supabaseUser
      .from('action_plans')
      .upsert({
        user_id: userId,
        period_start: periodStart,
        period_end: periodEnd,
        focus_tag: focusTag,
        items: actionItems,
      }, {
        onConflict: 'user_id,period_start,period_end'
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Failed to save action plan:', insertError);
      return json({ error: 'Failed to save action plan', detail: insertError.message }, 500);
    }

    // Return response
    const response: ActionPlanResponse = {
      plan_id: insertData.id,
      period_start: periodStart,
      period_end: periodEnd,
      focus_tag: focusTag,
      items: actionItems,
    };

    return json(response);
  } catch (e) {
    // Handle authentication errors
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
