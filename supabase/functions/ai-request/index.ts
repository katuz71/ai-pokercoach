import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type CoachStyle = 'toxic' | 'mental' | 'math';

type PlayerProfile = {
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  playsForMoney: 'no' | 'sometimes' | 'regular' | 'income';
  gameTypes: Array<'mtt' | 'cash' | 'sng' | 'live'>;
  goals: string[];
  weakAreas: string[];
  coachStyle: CoachStyle;
};

type HandInput = {
  holeCards: string;
  position: string;
  stackBb: number;
  gameType: 'mtt' | 'cash' | 'sng' | 'live';
  preAction: string;
  board?: string;
  notes?: string;
};

type AnalyzeHandBody = {
  kind: 'analyze_hand';
  profile: PlayerProfile;
  hand: HandInput;
};

type CoachChatBody = {
  mode: 'coach_chat';
  message: string;
  coach_style?: string;
  system_context?: string;
  top_leaks?: Array<{ tag: string; count: number; explanation: string }>;
};

type CoachResponse = {
  action: 'FOLD' | 'CALL' | 'RAISE' | 'CHECK' | 'BET';
  sizing?: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  why: string[];
  strategyNext: string[];
  mistakesToAvoid: string[];
  drill: string;
  evidence?: Array<{ type: string; id: string }>;
};

type CoachChatResponse = {
  reply: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildSystemPrompt(style: CoachStyle, profile: PlayerProfile) {
  const tone =
    style === 'toxic'
      ? 'Жёсткий профессиональный рег: коротко, саркастично, но без оскорблений личности. Фокус: дисциплина и ошибки.'
      : style === 'mental'
        ? 'Поддерживающий ментальный тренер: спокойно, уверенно, анти-тильт, дисциплина и план действий.'
        : 'Математичный GTO-аналитик: сухо, точно, диапазоны/EV, без воды.';

  return `Ты — персональный тренер по покеру (онлайн). Отвечай строго на русском.
Стиль: ${tone}
Контекст игрока: уровень=${profile.skillLevel}, деньги=${profile.playsForMoney}, форматы=${profile.gameTypes.join(', ') || '—'}.
Правила:
- Дай конкретное действие (FOLD/CALL/RAISE/CHECK/BET) и, если надо, сайзинг.
- Объяснение — по пунктам, без воды.
- Подсвети типичные ошибки именно в этом споте.
- Дай 1 короткое упражнение (drill) на закрепление.
- Не выдумывай фактов о пользователе; если данных мало — обозначь предположение.`;
}

function buildCoachChatSystemPrompt(coachStyle: string, systemContext?: string) {
  const style = coachStyle.toLowerCase();
  const tone =
    style === 'toxic'
      ? 'Жёсткий профессиональный рег: коротко, саркастично, но без оскорблений личности. Фокус: дисциплина и ошибки.'
      : style === 'mental'
        ? 'Поддерживающий ментальный тренер: спокойно, уверенно, анти-тильт, дисциплина и план действий.'
        : 'Математичный GTO-аналитик: сухо, точно, диапазоны/EV, без воды.';

  let prompt = `Ты — персональный тренер по покеру. Отвечай строго на русском.
Стиль: ${tone}

Правила:
- Давай конкретные советы по покеру
- Отвечай по пунктам, без воды
- Если игрок спрашивает о конкретной руке — проанализируй с точки зрения GTO и эксплойтов
- Если видишь повторяющиеся ошибки — укажи на них`;

  if (systemContext) {
    prompt += `\n\nКонтекст игрока:\n${systemContext}`;
  }

  return prompt;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Auth gate: require valid user JWT
    const { userId, supabaseUser } = await requireUserClient(req);

    // Handle multipart/form-data (voice transcription)
    if (req.headers.get('content-type')?.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return json({ error: 'no_file' }, 400);
      }

      const openAiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openAiKey) return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);

      // Convert file to buffer for Whisper
      const audioBuffer = await file.arrayBuffer();

      // Transcribe using OpenAI Whisper
      const formDataWhisper = new FormData();
      formDataWhisper.append('file', new File([audioBuffer], 'voice.m4a', { type: 'audio/m4a' }));
      formDataWhisper.append('model', 'whisper-1');

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
        },
        body: formDataWhisper,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        return json({ error: 'Whisper transcription failed', detail: errText }, 502);
      }

      const whisperBody = await whisperRes.text();
      let transcribedText = '';
      try {
        const parsed = JSON.parse(whisperBody) as { text?: string };
        transcribedText = typeof parsed?.text === 'string' ? parsed.text : '';
      } catch {
        transcribedText = whisperBody.trim();
      }

      if (!transcribedText.trim()) {
        return json({ error: 'transcription_empty', detail: 'No speech recognized' }, 400);
      }

      return json({ text: transcribedText });
    }

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return json(
        { error: 'Unsupported content type', detail: 'Use application/json for JSON body or multipart/form-data for voice' },
        400
      );
    }

    let body: AnalyzeHandBody | CoachChatBody;
    try {
      body = (await req.json()) as AnalyzeHandBody | CoachChatBody;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return json({ error: 'Invalid JSON body', detail: msg }, 400);
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    // Handle coach_chat mode
    if ('mode' in body && body.mode === 'coach_chat') {
      const coachStyle = body.coach_style || 'MENTAL';
      const systemPrompt = buildCoachChatSystemPrompt(coachStyle, body.system_context);

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: body.message },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        return json({ error: 'OpenAI request failed', detail: errText }, 502);
      }

      const payload = await openaiRes.json();
      const reply = payload.choices?.[0]?.message?.content || 'Нет ответа от тренера';

      return json({ reply } as CoachChatResponse);
    }

    // Handle analyze_hand (original logic)
    if ('kind' in body && body.kind === 'analyze_hand') {
      const system = buildSystemPrompt(body.profile.coachStyle, body.profile);
      const user = {
        profile: body.profile,
        hand: body.hand,
        instructions:
          'Сформируй ответ строго по JSON-схеме. Списки why/strategyNext/mistakesToAvoid: 3–6 пунктов. drill: 1 короткое предложение.',
      };

      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['FOLD', 'CALL', 'RAISE', 'CHECK', 'BET'] },
          sizing: { type: 'string' },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          why: { type: 'array', items: { type: 'string' }, minItems: 1 },
          strategyNext: { type: 'array', items: { type: 'string' }, minItems: 1 },
          mistakesToAvoid: { type: 'array', items: { type: 'string' }, minItems: 1 },
          drill: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string' },
                id: { type: 'string' },
              },
              required: ['type', 'id'],
            },
          },
        },
        required: ['action', 'confidence', 'why', 'strategyNext', 'mistakesToAvoid', 'drill'],
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
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(user) },
          ],
          // Structured Outputs
          text: {
            format: {
              type: 'json_schema',
              name: 'poker_coach_response',
              schema,
              strict: true,
            },
          },
          // Optional: disable storage if you want
          // store: false,
          metadata: {
            user_id: userId,
            kind: body.kind,
          },
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        return json({ error: 'OpenAI request failed', detail: errText }, 502);
      }

      const payload = await openaiRes.json();

      // Responses API returns output items; extract text
      const output = payload.output ?? [];
      let text = '';
      for (const item of output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.type === 'output_text' && typeof c.text === 'string') text += c.text;
          }
        }
      }

      const parsed: CoachResponse = JSON.parse(text || '{}');

      return json(parsed);
    }

    return json({ error: 'Unsupported request type' }, 400);
  } catch (err) {
    if (err instanceof AuthError) {
      return json(err.body, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: 'internal', detail: msg }, 500);
  }
});
