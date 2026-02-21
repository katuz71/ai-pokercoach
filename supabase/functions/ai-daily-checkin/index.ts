import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type DailyCheckin = {
  date: string;
  streak: number;
  focus: {
    tag: string | null;
    title: string;
    tip: string;
  };
  micro_drill: {
    question: string;
    answer: string;
  };
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

function getTodayUTC(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function calculateStreak(
  supabase: any,
  userId: string,
  today: string
): Promise<number> {
  // Fetch last 30 checkins (or more if needed for streak)
  const { data: checkins, error } = await supabase
    .from('daily_checkins')
    .select('checkin_date')
    .eq('user_id', userId)
    .order('checkin_date', { ascending: false })
    .limit(30);

  if (error || !checkins || checkins.length === 0) {
    return 1; // First check-in, streak = 1
  }

  // Parse dates and calculate streak
  const dates = checkins.map((c: any) => c.checkin_date).sort((a: string, b: string) => b.localeCompare(a));
  
  let streak = 1; // Today counts as 1
  const todayDate = new Date(today);

  for (let i = 0; i < dates.length; i++) {
    const checkDate = new Date(dates[i]);
    const expectedDate = new Date(todayDate);
    expectedDate.setDate(expectedDate.getDate() - (i + 1));

    // Check if this date is consecutive
    if (checkDate.toISOString().split('T')[0] === expectedDate.toISOString().split('T')[0]) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
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

    // Parse body
    const body = await req.json();
    const coachStyle = body.coach_style || 'MENTAL';
    const today = getTodayUTC();

    // Check if checkin already exists for today
    const { data: existingCheckin, error: existingError } = await supabaseUser
      .from('daily_checkins')
      .select('message')
      .eq('user_id', userId)
      .eq('checkin_date', today)
      .maybeSingle();

    if (existingError) {
      return json({ error: 'Failed to check existing checkin', detail: existingError.message }, 500);
    }

    if (existingCheckin) {
      // Return existing checkin
      return json(existingCheckin.message);
    }

    // Fetch latest leak summary
    const { data: latestLeakSummary } = await supabaseUser
      .from('leak_summaries')
      .select('summary')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let topLeaks: TopLeak[] = [];
    if (latestLeakSummary?.summary) {
      const summary = latestLeakSummary.summary as LeakSummary;
      topLeaks = summary.top_leaks || [];
    }

    // Fetch recent hand cases from coach_memory (optional context)
    const { data: memoryExamples } = await supabaseUser
      .from('coach_memory')
      .select('content, metadata')
      .eq('user_id', userId)
      .eq('type', 'hand_case')
      .order('created_at', { ascending: false })
      .limit(3);

    // Get OpenAI API key
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    // Build prompt
    const systemPrompt = `Ты — персональный тренер по покеру. Создаёшь короткий daily check-in для игрока.

Стиль тренера: ${coachStyle}
- TOXIC: жёсткий, прямолинейный, без политкорректности
- MENTAL: фокус на психологию, тильт, дисциплину
- MATH: математика, GTO, EV

Правила:
- focus.title и focus.tip: 1-2 предложения макс, конкретно
- Если есть top_leaks[0], используй его tag в focus.tag, иначе focus.tag = null
- micro_drill: 1 простой вопрос + короткий ответ (не A/B/C варианты)
- Формат строго JSON по схеме
- Пиши на русском`;

    let userPrompt = 'Создай daily check-in для игрока.\n\n';

    if (topLeaks.length > 0) {
      userPrompt += 'Топ ошибка игрока:\n';
      userPrompt += `- ${topLeaks[0].tag}: ${topLeaks[0].count}x\n`;
      userPrompt += `  ${topLeaks[0].explanation}\n\n`;
    } else {
      userPrompt += 'У игрока пока нет данных об ошибках. Дай общий совет для начинающих.\n\n';
    }

    if (memoryExamples && memoryExamples.length > 0) {
      userPrompt += 'Недавние разборы:\n';
      memoryExamples.forEach((mem) => {
        userPrompt += `- ${mem.content}\n`;
      });
      userPrompt += '\n';
    }

    userPrompt += 'Создай focus и micro_drill.';

    // JSON Schema for strict output
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        focus: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tag: { type: ['string', 'null'] },
            title: { type: 'string' },
            tip: { type: 'string' },
          },
          required: ['tag', 'title', 'tip'],
        },
        micro_drill: {
          type: 'object',
          additionalProperties: false,
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
          },
          required: ['question', 'answer'],
        },
      },
      required: ['focus', 'micro_drill'],
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
            name: 'daily_checkin',
            schema,
            strict: true,
          },
        },
        metadata: {
          user_id: userId,
          date: today,
          coach_style: coachStyle,
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
    let partialCheckin: { focus: any; micro_drill: any };
    try {
      partialCheckin = JSON.parse(text);
    } catch (e) {
      return json({ error: 'Failed to parse OpenAI response as JSON', detail: text }, 500);
    }

    // Calculate streak
    const streak = await calculateStreak(supabaseUser, userId, today);

    // Build full checkin
    const checkin: DailyCheckin = {
      date: today,
      streak,
      focus: partialCheckin.focus,
      micro_drill: partialCheckin.micro_drill,
    };

    // Save to daily_checkins (upsert)
    const { error: upsertError } = await supabaseUser
      .from('daily_checkins')
      .upsert({
        user_id: userId,
        checkin_date: today,
        message: checkin,
      }, {
        onConflict: 'user_id,checkin_date'
      });

    if (upsertError) {
      console.error('Failed to save daily checkin:', upsertError);
      // Don't fail the request, still return the checkin
    }

    // Return response
    return json(checkin);
  } catch (e) {
    // Handle authentication errors
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
