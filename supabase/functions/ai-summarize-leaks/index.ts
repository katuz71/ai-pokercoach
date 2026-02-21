import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type LeakAggregation = {
  tag: string;
  count: number;
  examples: string[];
};

type TopLeak = {
  tag: string;
  count: number;
  explanation: string;
};

type LeakSummary = {
  top_leaks: TopLeak[];
  improvement_plan: string[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    // Fetch last 30 hand analyses
    const { data: analyses, error: analysesError } = await supabaseUser
      .from('hand_analyses')
      .select('id, result, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (analysesError) {
      return json({ error: 'Failed to fetch analyses', detail: analysesError.message }, 500);
    }

    // Check minimum data requirement
    if (!analyses || analyses.length < 5) {
      return json({
        error: 'insufficient_data',
        message: 'Недостаточно данных для анализа. Добавь ещё разборы.',
        required: 5,
        current: analyses?.length || 0,
      }, 400);
    }

    // Aggregate leaks by allowed canonical tag
    const leakMap = new Map<string, LeakAggregation>();

    for (const analysis of analyses) {
      const result = analysis.result;
      const rawTag = result?.leak_link?.tag;

      if (rawTag && typeof rawTag === 'string') {
        // Enforce allowed tags for grouping
        const canonicalTag = enforceAllowedLeakTag(rawTag);
        
        // Skip if tag is null or empty
        if (!canonicalTag) continue;

        if (!leakMap.has(canonicalTag)) {
          leakMap.set(canonicalTag, {
            tag: canonicalTag,
            count: 0,
            examples: [],
          });
        }

        const leak = leakMap.get(canonicalTag)!;
        leak.count += 1;

        // Store first reason as example
        if (leak.examples.length < 3 && result.why && Array.isArray(result.why)) {
          leak.examples.push(result.why[0]);
        }
      }
    }

    // Sort by count and take top 3
    const topLeaks = Array.from(leakMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    if (topLeaks.length === 0) {
      return json({
        error: 'no_leaks_found',
        message: 'Не найдено ошибок для анализа',
      }, 400);
    }

    // Fetch some examples from coach_memory for context
    const { data: memoryExamples } = await supabaseUser
      .from('coach_memory')
      .select('content, metadata')
      .eq('user_id', userId)
      .eq('type', 'hand_case')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get OpenAI API key
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    // Build prompt
    const systemPrompt = `Ты — персональный тренер по покеру. Анализируешь повторяющиеся ошибки игрока.

Правила:
- Получаешь топ-3 ошибки (leak tags) с количеством повторений
- Для каждой ошибки дай краткое объяснение (2-3 предложения)
- Составь план улучшения из 3-5 пунктов
- Пиши на русском, конкретно и по делу
- Формат строго JSON по схеме`;

    let userPrompt = 'Топ ошибок игрока за последние 30 раздач:\n\n';

    topLeaks.forEach((leak, idx) => {
      userPrompt += `${idx + 1}. ${leak.tag}: ${leak.count} раз\n`;
      if (leak.examples.length > 0) {
        userPrompt += `   Примеры: ${leak.examples.join('; ')}\n`;
      }
    });

    if (memoryExamples && memoryExamples.length > 0) {
      userPrompt += '\n\nНекоторые прошлые разборы:\n';
      memoryExamples.slice(0, 3).forEach((mem) => {
        userPrompt += `- ${mem.content}\n`;
      });
    }

    userPrompt += '\n\nСоставь объяснение каждой ошибки и план улучшения.';

    // JSON Schema for strict output
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        top_leaks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tag: { type: 'string' },
              count: { type: 'number' },
              explanation: { type: 'string' },
            },
            required: ['tag', 'count', 'explanation'],
          },
          minItems: 1,
        },
        improvement_plan: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
      },
      required: ['top_leaks', 'improvement_plan'],
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
            name: 'leak_summary',
            schema,
            strict: true,
          },
        },
        metadata: {
          user_id: userId,
          leak_count: String(topLeaks.length),
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
    let summary: LeakSummary;
    try {
      summary = JSON.parse(text);
    } catch (e) {
      return json({ error: 'Failed to parse OpenAI response as JSON', detail: text }, 500);
    }

    // Validate required fields
    if (
      !Array.isArray(summary.top_leaks) ||
      !Array.isArray(summary.improvement_plan) ||
      summary.top_leaks.length === 0
    ) {
      return json({ error: 'Invalid response schema from OpenAI', detail: summary }, 500);
    }

    // Enforce allowed tags in summary
    summary.top_leaks = summary.top_leaks.map(leak => ({
      ...leak,
      tag: enforceAllowedLeakTag(leak.tag) || 'fundamentals',
    }));

    // Calculate period (last 30 days)
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 30);

    // Save to leak_summaries
    const { data: insertData, error: insertError } = await supabaseUser
      .from('leak_summaries')
      .insert({
        user_id: userId,
        period_start: periodStart.toISOString().split('T')[0],
        period_end: periodEnd.toISOString().split('T')[0],
        summary: summary,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Failed to save leak summary:', insertError);
      // Don't fail the request, still return the summary
    }

    // Return response
    return json({
      summary_id: insertData?.id || null,
      period_start: periodStart.toISOString().split('T')[0],
      period_end: periodEnd.toISOString().split('T')[0],
      total_analyses: analyses.length,
      summary: summary,
    });
  } catch (e) {
    // Handle authentication errors
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
