import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type CoachStyle = 'TOXIC' | 'MENTAL' | 'MATH';

// Legacy flat fields (still used when mode is not quick_form and no raw_text)
type HandInputLegacy = {
  hero_cards?: string;
  position?: string;
  stack_bb?: number;
  action_preflop?: string;
  board?: string;
  notes?: string;
  raw_text?: string;
};

// Quick Form / OCR Extract structured payload
type StreetsInput = {
  preflop?: string | null;
  flop?: string | null;
  turn?: string | null;
  river?: string | null;
};
type BoardStructuredInput = {
  flop?: string | null;
  turn?: string | null;
  river?: string | null;
};
type QuickFormInput = {
  mode: 'quick_form';
  hero_pos?: string | null;
  effective_stack_bb?: number | null;
  streets?: StreetsInput | null;
  board_structured?: BoardStructuredInput | null;
  board?: string | null;
  source?: 'manual' | 'ocr_extract' | null;
  game?: string | null;
  stakes?: string | null;
  // legacy flat fields may be present for backward compat
  hero_cards?: string | null;
  position?: string | null;
  stack_bb?: number | null;
  action_preflop?: string | null;
};

type HandInput = HandInputLegacy & {
  mode?: 'quick_form';
  hero_pos?: string | null;
  effective_stack_bb?: number | null;
  streets?: StreetsInput | null;
  board_structured?: BoardStructuredInput | null;
  source?: 'manual' | 'ocr_extract' | null;
  game?: string | null;
  stakes?: string | null;
};

type HandAnalysisRequest = {
  input: HandInput;
  coach_style: CoachStyle;
};

type InputMode = 'quick_form' | 'text' | 'legacy';
type ResolvedPrompt = { text: string; mode: InputMode; source?: string };

type HandAnalysisResult = {
  action: 'RAISE' | 'CALL' | 'FOLD' | 'CHECK' | 'BET';
  sizing: string | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  why: string[];
  strategy_next: string[];
  common_mistakes: string[];
  leak_link: {
    tag: string;
    evidence_ids: string[];
  };
  drill: {
    title: string;
    steps: string[];
  };
};

type RetrievedMemory = {
  id: string;
  content: string;
  metadata: any;
};

type TopLeak = {
  tag: string;
  count: number;
  explanation: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const MAX_STREET_LENGTH = 1500;

function removeNonPrintable(s: string): string {
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function sanitizeStreet(s: string | null | undefined): string {
  if (s == null || typeof s !== 'string') return '';
  const cleaned = removeNonPrintable(s.trim());
  return cleaned.length > MAX_STREET_LENGTH ? cleaned.slice(0, MAX_STREET_LENGTH) : cleaned;
}

function getBoardFromInput(input: HandInput): { flop: string; turn: string; river: string } | null {
  const structured = input.board_structured;
  if (structured && (structured.flop != null || structured.turn != null || structured.river != null)) {
    const flop = sanitizeStreet(structured.flop).slice(0, 50);
    const turn = sanitizeStreet(structured.turn).slice(0, 10);
    const river = sanitizeStreet(structured.river).slice(0, 10);
    return { flop, turn, river };
  }
  return null;
}

function buildCanonicalTextFromStructured(input: HandInput & { mode: 'quick_form' }): string {
  const source = input.source === 'ocr_extract' ? 'ocr_extract' : 'manual';
  const game = input.game?.trim() || 'UNKNOWN';
  const stakes = input.stakes?.trim() || 'null';
  const heroPos = input.hero_pos?.trim() || 'UNKNOWN';
  const stackBb = input.effective_stack_bb != null ? String(input.effective_stack_bb) : 'null';
  const streets = input.streets ?? {};
  const preflop = sanitizeStreet(streets.preflop);
  const flop = sanitizeStreet(streets.flop);
  const turn = sanitizeStreet(streets.turn);
  const river = sanitizeStreet(streets.river);

  const board = getBoardFromInput(input);
  const boardLine = board
    ? `Board: Flop ${board.flop || '—'}, Turn ${board.turn || '—'}, River ${board.river || '—'}`
    : 'Board: (none)';

  const lines = [
    `Mode: QUICK_FORM (source=${source})`,
    `Game: ${game}, Stakes: ${stakes}`,
    `Hero position: ${heroPos}, Effective stack: ${stackBb} bb`,
    `Preflop: ${preflop || '(empty)'}`,
    `Flop: ${flop || 'null'}`,
    `Turn: ${turn || 'null'}`,
    `River: ${river || 'null'}`,
    boardLine,
  ];
  return lines.join('\n');
}

function resolveInputMode(input: HandInput): InputMode {
  if (input?.mode === 'quick_form') return 'quick_form';
  if (input?.raw_text != null && typeof input.raw_text === 'string') return 'text';
  return 'legacy';
}

/** Returns prompt text for LLM + embedding, and mode/source for logging. Validates quick_form preflop empty → throws. */
function getTextForLLM(input: HandInput): ResolvedPrompt {
  const mode = resolveInputMode(input);
  if (mode === 'quick_form') {
    const streets = input.streets ?? {};
    const preflop = sanitizeStreet(streets.preflop);
    if (!preflop) {
      const err = new Error('preflop_required') as Error & { code?: string };
      err.code = 'preflop_required';
      throw err;
    }
    const text = buildCanonicalTextFromStructured(input as HandInput & { mode: 'quick_form' });
    return { text, mode: 'quick_form', source: input.source ?? undefined };
  }
  if (mode === 'text') {
    const raw = (input.raw_text ?? '').trim();
    return { text: raw || 'Нет данных о раздаче.', mode: 'text' };
  }
  // legacy: build from flat fields
  const text = buildUserPrompt(input as HandInputLegacy);
  return { text, mode: 'legacy' };
}

// Generate embedding using OpenAI
async function generateEmbedding(text: string, openAiKey: string): Promise<number[]> {
  const embeddingModel = 'text-embedding-3-small';
  
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: text,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Embedding generation failed: ${errText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Retrieve top K similar memories from coach_memory
async function retrieveMemories(
  supabase: any,
  userId: string,
  queryEmbedding: number[],
  topK = 5
): Promise<RetrievedMemory[]> {
  // Convert embedding array to pgvector format string
  const embeddingString = `[${queryEmbedding.join(',').slice(0, 65535)}]`;

  // Query using pgvector similarity search
  const { data, error } = await supabase.rpc('match_coach_memory', {
    query_embedding: embeddingString,
    match_threshold: 0.75,
    match_count: topK,
    filter_user_id: userId,
  }).select('id, content, metadata');

  if (error) {
    // If RPC doesn't exist yet, fall back to direct query
    // This is a simpler approach for initial deployment
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('coach_memory')
      .select('id, content, metadata, embedding')
      .eq('user_id', userId)
      .not('embedding', 'is', null)
      .limit(topK);

    if (fallbackError) {
      console.error('Failed to retrieve memories:', fallbackError);
      return [];
    }

    return fallbackData || [];
  }

  return data || [];
}

// Retrieve latest leak summary for the user
async function getLatestLeakSummary(supabase: any, userId: string): Promise<TopLeak[]> {
  try {
    const { data, error } = await supabase
      .from('leak_summaries')
      .select('summary')
      .eq('user_id', userId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return [];
    }

    const summary = data.summary;
    if (!summary || !Array.isArray(summary.top_leaks)) {
      return [];
    }

    return summary.top_leaks;
  } catch (error) {
    console.error('Failed to retrieve leak summary:', error);
    return [];
  }
}

// Create a summary of the hand analysis for storage (supports quick_form and legacy input)
function createHandSummary(input: HandInput, result: HandAnalysisResult): string {
  const parts: string[] = [];
  const pos = input.hero_pos ?? input.position;
  const stack = input.effective_stack_bb ?? input.stack_bb;
  if (pos) parts.push(`Позиция: ${pos}`);
  if (input.hero_cards) parts.push(`Карты: ${input.hero_cards}`);
  if (stack != null) parts.push(`Стек: ${stack}BB`);

  parts.push(`Решение: ${result.action}${result.sizing ? ' (' + result.sizing + ')' : ''}`);
  if (result.leak_link?.tag) {
    parts.push(`Тип ошибки: ${result.leak_link.tag}`);
  }
  if (result.why.length > 0) {
    parts.push(`Причина: ${result.why[0]}`);
  }
  return parts.join('. ');
}

// Helper: check if line is garbage after cleanup (punctuation, short fragments)
function isGarbageLine(s: string): boolean {
  const trimmed = s.trim();
  
  // Too short to be meaningful
  if (trimmed.length < 15) return true;
  
  // Starts or ends with dangling punctuation
  if (/^[—\-:,;.]/.test(trimmed) || /[—\-:,;.]$/.test(trimmed)) {
    // If it's very short and has punctuation, it's garbage
    if (trimmed.length < 20) return true;
  }
  
  // Only punctuation and short words
  const wordsOnly = trimmed.replace(/[^\wа-яА-ЯёЁ]/g, '');
  if (wordsOnly.length < 10) return true;
  
  return false;
}

// Helper: remove consecutive duplicate lines
function dedupeConsecutive(arr: string[]): string[] {
  const result: string[] = [];
  let lastLine = '';
  
  for (const line of arr) {
    const normalized = line.trim().toLowerCase();
    if (normalized !== lastLine) {
      result.push(line);
      lastLine = normalized;
    }
  }
  
  return result;
}

// Sanitize coaching text to enforce evidence-backed rules
function sanitizeCoachingText(
  result: HandAnalysisResult,
  topLeaks: TopLeak[]
): HandAnalysisResult {
  const hasEvidence = result.leak_link.evidence_ids.length > 0;
  const topLeakTags = topLeaks.map(leak => leak.tag);
  const isTopLeak = topLeakTags.includes(result.leak_link.tag);

  // Forbidden phrases that require evidence
  const forbiddenWithoutEvidence = [
    /\bты всегда\b/gi,
    /\bты постоянно\b/gi,
    /\bты часто\b/gi,
    /\bкак обычно\b/gi,
    /\bопять ты\b/gi,
    /\bв очередной раз\b/gi,
    /\bэто типично для тебя\b/gi,
    /\bты регулярно\b/gi,
  ];

  // Phrases about top leaks that require tag match
  const topLeakPhrases = [
    /входит в тво[иё] топ[-\s]?\d+/gi,
    /одна из тво[иё]х главных ошибок/gi,
    /системная ошибка/gi,
    /повторяющаяся проблема/gi,
  ];

  const neutralReplacement = 'Это распространённая ошибка в таких спотах.';

  // Filter function for text arrays
  const filterTextArray = (arr: string[]): string[] => {
    const processed = arr
      .map(text => {
        const originalText = text;
        let cleaned = text;

        // Remove forbidden phrases if no evidence
        if (!hasEvidence) {
          forbiddenWithoutEvidence.forEach(pattern => {
            cleaned = cleaned.replace(pattern, '');
          });
        }

        // Remove top leak references if tag doesn't match
        if (!isTopLeak) {
          topLeakPhrases.forEach(pattern => {
            cleaned = cleaned.replace(pattern, '');
          });
        }

        cleaned = cleaned.trim();

        // If original was meaningful (>25 chars) but cleaned is too short/garbage
        // Replace with neutral phrase
        if (originalText.length > 25 && (cleaned.length < 15 || isGarbageLine(cleaned))) {
          return neutralReplacement;
        }

        // If cleaned is garbage, mark for removal
        if (isGarbageLine(cleaned)) {
          return '';
        }

        return cleaned;
      })
      .filter(text => text.length > 0);

    // Remove consecutive duplicates
    return dedupeConsecutive(processed);
  };

  return {
    ...result,
    why: filterTextArray(result.why),
    strategy_next: filterTextArray(result.strategy_next),
    common_mistakes: filterTextArray(result.common_mistakes),
  };
}

function buildSystemPrompt(
  style: CoachStyle,
  pastMemories: RetrievedMemory[],
  topLeaks: TopLeak[]
): string {
  const toneRules = {
    TOXIC: 'Жёсткий профессиональный рег: коротко, саркастично, но без оскорблений личности. Фокус на дисциплине и выявлении ошибок.',
    MENTAL: 'Поддерживающий ментальный тренер: спокойно, уверенно, анти-тильт. Дисциплина и план действий.',
    MATH: 'Математичный GTO-аналитик: сухо, точно, диапазоны/EV, без лишних слов.',
  };

  const tone = toneRules[style];

  let memoryContext = '';
  if (pastMemories.length > 0) {
    memoryContext = `\n\nПрошлые паттерны и протечки игрока:\n`;
    pastMemories.forEach((mem, idx) => {
      memoryContext += `${idx + 1}. ${mem.content}`;
      if (mem.metadata?.analysis_id) {
        memoryContext += ` [ID: ${mem.metadata.analysis_id}]`;
      }
      memoryContext += '\n';
    });
    memoryContext += `\nВАЖНО: 
- Если текущая ситуация ЯВНО похожа на прошлые случаи — укажи их ID в evidence_ids.
- Если совпадение слабое или отсутствует — evidence_ids должен быть пустым массивом [].
- НЕ выдумывай паттерны типа "ты всегда" или "постоянно", если это не подтверждено найденными кейсами.`;
  }

  let topLeaksContext = '';
  if (topLeaks.length > 0) {
    topLeaksContext = `\n\nТоп-${topLeaks.length} системных ошибок игрока (последние 30 дней):\n`;
    topLeaks.forEach((leak, idx) => {
      topLeaksContext += `${idx + 1}. ${leak.tag} (${leak.count} случаев)\n`;
    });
    topLeaksContext += `\nПРАВИЛА ПО СИСТЕМНЫМ ОШИБКАМ:
- Если текущая раздача РЕАЛЬНО относится к одной из этих ошибок — усиль объяснение.
- Фразу "Это входит в твои топ-${topLeaks.length} ошибок за последние 30 дней" можно использовать ТОЛЬКО если leak_link.tag ТОЧНО совпадает с одним из перечисленных выше тегов.
- Если leak_link.tag НЕ совпадает ни с одним из топ-тегов — НЕ упоминай топ-ошибки вообще.`;
  }

  const evidenceBackedRules = `

КРИТИЧЕСКИ ВАЖНО — Evidence-backed coaching:
1. ЗАПРЕЩЕНО использовать фразы без доказательств:
   - "ты всегда", "ты постоянно", "ты часто"
   - "как обычно", "опять ты", "в очередной раз"
   - "это типично для тебя", "ты регулярно"
   
   МОЖНО использовать эти фразы ТОЛЬКО если:
   - evidence_ids содержит хотя бы 1 реальный ID из контекста выше
   
2. Фразу про "топ-3 ошибок" или "входит в твои топ-N" можно писать ТОЛЬКО если:
   - текущий leak_link.tag ТОЧНО совпадает с одним из тегов из топ-ошибок выше
   
3. Если нет evidence_ids — используй нейтральные формулировки:
   - "Это распространённая ошибка в таких спотах"
   - "Многие игроки ошибаются здесь"
   - "Типичная проблема на этой позиции"`;

  return `Ты — персональный тренер по покеру (онлайн). Отвечай строго на русском.
Стиль общения: ${tone}${memoryContext}${topLeaksContext}${evidenceBackedRules}

Правила:
- Проанализируй ситуацию и дай конкретное действие (RAISE/CALL/FOLD/CHECK/BET) с сайзингом, если применимо.
- Объяснение (why) — по пунктам (3-5 пунктов), без воды, конкретно.
- Дай стратегию на следующие улицы (strategy_next) — 2-4 пункта.
- Подсвети типичные ошибки в этом споте (common_mistakes) — 2-4 пункта.
- Дай одно короткое упражнение (drill) с заголовком и шагами для закрепления навыка.
- Не выдумывай фактов; если данных мало — обозначь предположение.
- В leak_link.evidence_ids указывай ТОЛЬКО реальные ID из контекста выше, если ситуация действительно похожа.
- Если нет явного совпадения с прошлыми случаями — evidence_ids = [].

ВАЖНО: Отвечай строго в формате JSON по схеме. Факты одинаковые для всех стилей, меняется только тон изложения.`;
}

function buildUserPrompt(input: HandInput): string {
  const parts: string[] = [];

  if (input.hero_cards) parts.push(`Карты героя: ${input.hero_cards}`);
  if (input.position) parts.push(`Позиция: ${input.position}`);
  if (input.stack_bb) parts.push(`Стек: ${input.stack_bb}BB`);
  if (input.action_preflop) parts.push(`Действия префлоп: ${input.action_preflop}`);
  if (input.board) parts.push(`Борд: ${input.board}`);
  if (input.notes) parts.push(`Заметки: ${input.notes}`);
  if (input.raw_text) parts.push(`Текст раздачи:\n${input.raw_text}`);

  if (parts.length === 0) {
    return 'Нет данных о раздаче. Дай общие рекомендации.';
  }

  return parts.join('\n');
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
    const body = (await req.json()) as HandAnalysisRequest;
    if (!body.input || !body.coach_style) {
      return json({ error: 'Missing required fields: input, coach_style' }, 400);
    }

    // Get OpenAI API key
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

    // Resolve prompt text: quick_form (canonical) / text (raw_text) / legacy (flat fields)
    let resolved: ResolvedPrompt;
    try {
      resolved = getTextForLLM(body.input);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === 'preflop_required') {
        return json({ error: 'preflop_required' }, 400);
      }
      throw e;
    }
    const userPrompt = resolved.text;
    console.log('analyze-hand', {
      mode: resolved.mode,
      source: resolved.source ?? null,
      textLength: userPrompt.length,
    });

    // Generate embedding for the query (same text as sent to LLM)
    let queryEmbedding: number[] = [];
    let retrievedMemories: RetrievedMemory[] = [];

    try {
      queryEmbedding = await generateEmbedding(userPrompt, openAiKey);
      
      // Retrieve similar past memories
      retrievedMemories = await retrieveMemories(supabaseUser, userId, queryEmbedding, 5);
    } catch (embError) {
      // Log but don't fail - continue without RAG if embedding fails
      console.error('RAG retrieval failed:', embError);
    }

    // Retrieve latest leak summary (top leaks from last 30 days)
    let topLeaks: TopLeak[] = [];
    try {
      topLeaks = await getLatestLeakSummary(supabaseUser, userId);
    } catch (leakError) {
      // Log but don't fail - continue without leak awareness
      console.error('Leak summary retrieval failed:', leakError);
    }

    // Build system prompt with memory context and top leaks
    const systemPrompt = buildSystemPrompt(body.coach_style, retrievedMemories, topLeaks);

    // JSON Schema for strict output
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['RAISE', 'CALL', 'FOLD', 'CHECK', 'BET'],
        },
        sizing: {
          type: ['string', 'null'],
        },
        confidence: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
        },
        why: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        strategy_next: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        common_mistakes: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        leak_link: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tag: { type: 'string' },
            evidence_ids: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['tag', 'evidence_ids'],
        },
        drill: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            steps: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
          },
          required: ['title', 'steps'],
        },
      },
      required: [
        'action',
        'sizing',
        'confidence',
        'why',
        'strategy_next',
        'common_mistakes',
        'leak_link',
        'drill',
      ],
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
            name: 'hand_analysis_result',
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
    let result: HandAnalysisResult;
    try {
      result = JSON.parse(text);
    } catch (e) {
      return json({ error: 'Failed to parse OpenAI response as JSON', detail: text }, 500);
    }

    // Validate required fields
    if (
      !result.action ||
      !result.confidence ||
      !Array.isArray(result.why) ||
      !Array.isArray(result.strategy_next) ||
      !Array.isArray(result.common_mistakes) ||
      !result.leak_link ||
      !result.drill
    ) {
      return json({ error: 'Invalid response schema from OpenAI', detail: result }, 500);
    }

    // Apply evidence-backed coaching sanitization
    result = sanitizeCoachingText(result, topLeaks);

    // Enforce allowed leak tags whitelist
    result.leak_link.tag = enforceAllowedLeakTag(result.leak_link.tag) ?? '';

    // Save to database
    const { data: insertData, error: insertError } = await supabaseUser
      .from('hand_analyses')
      .insert({
        user_id: userId,
        input: body.input,
        result: result,
        mistake_tags: [],
      })
      .select('id')
      .single();

    if (insertError) {
      return json({ error: 'Failed to save analysis', detail: insertError.message }, 500);
    }

    const analysisId = insertData.id;

    // Create and save memory summary
    try {
      const summary = createHandSummary(body.input, result);
      const summaryEmbedding = await generateEmbedding(summary, openAiKey);
      const embeddingString = `[${summaryEmbedding.join(',')}]`;

      await supabaseUser.from('coach_memory').insert({
        user_id: userId,
        type: 'hand_case',
        content: summary,
        metadata: {
          analysis_id: analysisId,
          mistake_tag: enforceAllowedLeakTag(result.leak_link?.tag),
        },
        embedding: embeddingString,
      });
    } catch (memoryError) {
      // Log but don't fail the request if memory save fails
      console.error('Failed to save memory:', memoryError);
    }

    // Return response
    return json({
      analysis_id: analysisId,
      result: result,
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
