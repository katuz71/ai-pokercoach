import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';

type CoachChatBody = {
  thread_id: string | null;
  message?: string;
  coach_style?: string | null;
  stream?: boolean;
  mode?: 'user' | 'continue';
  continue_context?: { partial_assistant_text: string };
};

type ChatMessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

type ChatThreadRow = {
  id: string;
  title: string | null;
  leak_tag: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** First 32 chars of message: trim, single line (no newlines). No LLM. */
function threadTitleFromMessage(msg: string): string {
  return msg.replace(/\s+/g, ' ').trim().slice(0, 32);
}

type MemoryRow = {
  id?: string;
  content?: string;
  metadata?: { message_ids?: string[]; tags?: string[] };
};

export type CoachChatEvidence = {
  memory_ids: string[];
  message_ids: string[];
  tags: string[];
};

const LEAK_CLAIM_TRIGGERS = [
  /ты часто/gi,
  /ты всегда/gi,
  /обычно ты/gi,
  /у тебя проблема/gi,
  /твой главный лик/gi,
  /твоя ошибка в том что/gi,
] as const;

const LEAK_CLAIM_NEUTRAL_REPLACEMENTS: [RegExp, string][] = [
  [/ты часто/gi, 'в этой ситуации возможно часто'],
  [/ты всегда/gi, 'здесь возможно всегда'],
  [/обычно ты/gi, 'в данном случае ты'],
  [/у тебя проблема/gi, 'здесь возможная проблема'],
  [/твой главный лик/gi, 'один из возможных ликов'],
  [/твоя ошибка в том что/gi, 'возможная ошибка в том что'],
];

function hasEvidenceFromMemories(memories: MemoryRow[]): boolean {
  return memories.some((m) => {
    const meta = m.metadata;
    if (!meta) return false;
    const hasMessageIds = (meta.message_ids?.length ?? 0) > 0;
    const hasLeakTag = Array.isArray(meta.tags) && meta.tags.length > 0;
    return hasMessageIds || hasLeakTag;
  });
}

function containsLeakClaimTrigger(text: string): boolean {
  return LEAK_CLAIM_TRIGGERS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/**
 * Sanitizes assistant text: if it contains leak-style claims (ты часто, ты всегда, ...)
 * but RAG context has no evidence (no message_ids or leak tags), replaces with neutral wording.
 * Called before saving to DB; does not affect streaming.
 */
function sanitizeLeakClaims(text: string, hasEvidence: boolean): string {
  if (!containsLeakClaimTrigger(text)) return text;
  if (hasEvidence) return text;
  console.warn('Leak claim sanitized (no evidence)');
  let out = text;
  for (const [re, replacement] of LEAK_CLAIM_NEUTRAL_REPLACEMENTS) {
    re.lastIndex = 0;
    out = out.replace(re, replacement);
  }
  return 'На основе текущего диалога (без накопленной статистики): ' + out;
}

type LeakStats = {
  rating?: number;
  attempts_7d?: number;
  correct_7d?: number;
  streak_correct?: number;
  top_mistakes?: string[];
};

function buildSystemPrompt(
  coachStyle: string,
  memoryLines: { text: string; evidenceIds?: string[] }[],
  conversationBlock: string,
  leakTag: string | null,
  leakStats: LeakStats | null
): string {
  const style = (coachStyle || 'mental').toLowerCase();
  const tone =
    style === 'toxic'
      ? 'Жёсткий профессиональный рег: коротко, саркастично, но без оскорблений личности. Фокус: дисциплина и ошибки.'
      : style === 'mental'
        ? 'Поддерживающий ментальный тренер: спокойно, уверенно, анти-тильт, дисциплина и план действий.'
        : 'Математичный GTO-аналитик: сухо, точно, диапазоны/EV, без воды.';

  let system = `Ты — AI Poker Coach. Отвечай строго на русском.
Стиль: ${tone}

Правила:
- Давай конкретные советы по покеру, по пунктам, без воды.
- Не выдумывай фактов о пользователе — только на основе контекста ниже и истории диалога.
- Если говоришь про паттерн игрока (часто/всегда/обычно) — укажи evidence_message_ids или не используй частотные слова. Без evidence не утверждай частоту.
`;

  if (leakTag) {
    system += `\n\nЭтот тред сфокусирован на лике: ${leakTag}. Держи ответы в рамках этого лика, если пользователь не просит иначе.
- Всегда давай: (1) краткий диагноз (1–2 строки), (2) правило большого пальца, (3) одну идею дрилла, привязанную к этому лику.
- Избегай абсолютов («всегда/никогда»), если нет evidence_ids.

`;
    if (leakStats && (leakStats.rating != null || leakStats.top_mistakes?.length)) {
      const parts: string[] = [];
      if (leakStats.rating != null) parts.push(`rating=${leakStats.rating}`);
      if (leakStats.attempts_7d != null && leakStats.correct_7d != null && leakStats.attempts_7d > 0) {
        const acc7 = Math.round((leakStats.correct_7d / leakStats.attempts_7d) * 100);
        parts.push(`7d accuracy=${acc7}%`);
      }
      if (leakStats.streak_correct != null) parts.push(`streak_correct=${leakStats.streak_correct}`);
      if (leakStats.top_mistakes?.length) parts.push(`common mistakes: ${leakStats.top_mistakes.join(', ')}`);
      system += `Player stats for this leak: ${parts.join(', ')}.\n`;
    }
  }

  if (memoryLines.length > 0) {
    system += '\n\nRelevant memory snippets (Player memory):\n';
    for (const line of memoryLines) {
      system += line.text;
      if (line.evidenceIds?.length) {
        system += ` [Evidence IDs: ${line.evidenceIds.join(', ')}]`;
      }
      system += '\n';
    }
  }

  if (conversationBlock.trim()) {
    system += `\n\nConversation (последние сообщения):\n${conversationBlock}\n`;
  }

  return system;
}

async function getEmbedding(openAiKey: string, text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding failed: ${errText}`);
  }
  const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error('Invalid embedding response');
  }
  return embedding;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed', detail: 'Use POST' }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return json({ error: 'Unsupported content type', detail: 'Use application/json' }, 400);
    }

    let body: CoachChatBody;
    try {
      body = (await req.json()) as CoachChatBody;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return json({ error: 'Invalid JSON body', detail: msg }, 400);
    }

    const isContinue = body.mode === 'continue';
    const partialAssistantText = typeof body.continue_context?.partial_assistant_text === 'string'
      ? body.continue_context.partial_assistant_text.trim()
      : '';

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (isContinue) {
      if (!body.thread_id) {
        return json({ error: 'thread_id_required', detail: 'thread_id is required for mode "continue"' }, 400);
      }
      if (!partialAssistantText) {
        return json({ error: 'continue_context_required', detail: 'continue_context.partial_assistant_text is required for mode "continue"' }, 400);
      }
    } else {
      if (!message) {
        return json({ error: 'message_required', detail: 'message is required and must be non-empty' }, 400);
      }
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret', detail: 'Server misconfiguration' }, 500);
    }

    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';
    const coachStyle = body.coach_style ?? 'mental';

    let threadId: string;
    let shouldSetTitle = false;
    let newTitle = '';
    let last20: ChatMessageRow[];
    let systemPrompt: string;
    let effectiveLeakTag: string | null = null;

    if (isContinue) {
      const { data: thread, error: threadError } = await supabaseUser
        .from('chat_threads')
        .select('id, title, leak_tag')
        .eq('id', body.thread_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (threadError || !thread) {
        return json({ error: 'thread_not_found', detail: 'Thread not found or access denied' }, 404);
      }
      threadId = (thread as ChatThreadRow).id;
      effectiveLeakTag = enforceAllowedLeakTag((thread as ChatThreadRow).leak_tag);

      const { data: recentMessages, error: messagesError } = await supabaseUser
        .from('chat_messages')
        .select('id, role, content, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(20);

      if (messagesError) {
        return json({ error: 'Failed to load history', detail: messagesError.message }, 500);
      }
      last20 = (recentMessages ?? []) as ChatMessageRow[];
    } else {
      if (body.thread_id) {
        const { data: thread, error: threadError } = await supabaseUser
          .from('chat_threads')
          .select('id, title, leak_tag')
          .eq('id', body.thread_id)
          .eq('user_id', userId)
          .maybeSingle();

        if (threadError || !thread) {
          return json({ error: 'thread_not_found', detail: 'Thread not found or access denied' }, 404);
        }
        const t = thread as ChatThreadRow;
        threadId = t.id;
        effectiveLeakTag = enforceAllowedLeakTag(t.leak_tag);
        const hasNoTitle = t.title == null || String(t.title).trim() === '';
        if (hasNoTitle) {
          shouldSetTitle = true;
          newTitle = threadTitleFromMessage(message);
        }
      } else {
        newTitle = threadTitleFromMessage(message);
        const { data: newThread, error: insertThreadError } = await supabaseUser
          .from('chat_threads')
          .insert({
            user_id: userId,
            title: newTitle,
            coach_style: coachStyle,
          })
          .select('id')
          .single();

        if (insertThreadError || !newThread) {
          return json({ error: 'Failed to create thread', detail: insertThreadError?.message ?? 'Unknown' }, 500);
        }
        threadId = newThread.id;
      }

      const { error: insertUserError } = await supabaseUser
        .from('chat_messages')
        .insert({
          thread_id: threadId,
          user_id: userId,
          role: 'user',
          content: message,
        });

      if (insertUserError) {
        return json({ error: 'Failed to save message', detail: insertUserError.message }, 500);
      }

      const { data: recentMessages, error: messagesError } = await supabaseUser
        .from('chat_messages')
        .select('id, role, content, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(21);

      if (messagesError) {
        return json({ error: 'Failed to load history', detail: messagesError.message }, 500);
      }
      last20 = (recentMessages ?? []).slice(-20) as ChatMessageRow[];
    }

    const conversationBlock = last20
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    let leakStats: LeakStats | null = null;
    if (effectiveLeakTag) {
      const { data: ratingRow } = await supabaseUser
        .from('skill_ratings')
        .select('rating, attempts_7d, correct_7d, streak_correct')
        .eq('user_id', userId)
        .eq('leak_tag', effectiveLeakTag)
        .maybeSingle();
      if (ratingRow) {
        leakStats = {
          rating: (ratingRow as { rating?: number }).rating,
          attempts_7d: (ratingRow as { attempts_7d?: number }).attempts_7d,
          correct_7d: (ratingRow as { correct_7d?: number }).correct_7d,
          streak_correct: (ratingRow as { streak_correct?: number }).streak_correct,
        };
      }
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: mistakeRows } = await supabaseUser
        .from('training_events')
        .select('mistake_reason')
        .eq('user_id', userId)
        .eq('leak_tag', effectiveLeakTag)
        .eq('is_correct', false)
        .gte('created_at', since30d);
      if (Array.isArray(mistakeRows) && mistakeRows.length > 0) {
        const counts: Record<string, number> = {};
        for (const row of mistakeRows) {
          const r = (row as { mistake_reason?: string | null }).mistake_reason;
          const key = (r && String(r).trim()) || 'unknown';
          counts[key] = (counts[key] ?? 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const top_mistakes = sorted.slice(0, 2).map(([reason]) => reason);
        leakStats = leakStats ?? {};
        leakStats.top_mistakes = top_mistakes;
      }
    }

    const textForRag = isContinue
      ? (last20.filter((m) => m.role === 'user').pop()?.content ?? '')
      : message;
    const textForEmbedding = effectiveLeakTag
      ? `leak: ${effectiveLeakTag} ${textForRag}`.trim()
      : textForRag;
    let memoryLines: { text: string; evidenceIds?: string[] }[] = [];
    let hasEvidence = false;
    const evidence: CoachChatEvidence = { memory_ids: [], message_ids: [], tags: [] };
    try {
      if (textForEmbedding) {
        const embedding = await getEmbedding(openAiKey, textForEmbedding.slice(0, 8000));
        const { data: memories, error: rpcError } = await supabaseUser.rpc('match_coach_memory', {
          query_embedding: embedding,
          match_threshold: 0.5,
          match_count: 5,
          filter_user_id: userId,
        });
        if (!rpcError && Array.isArray(memories) && memories.length > 0) {
          const memRows = memories as MemoryRow[];
          hasEvidence = hasEvidenceFromMemories(memRows);
          const usedRows = memRows.filter((m) => (m.content ?? '').trim());
          memoryLines = usedRows.map((m) => ({
            text: (m.content ?? '').trim(),
            evidenceIds: (m.metadata?.message_ids as string[] | undefined)?.filter(Boolean),
          }));
          evidence.memory_ids = usedRows.map((m) => m.id).filter((id): id is string => typeof id === 'string');
          evidence.message_ids = [...new Set(usedRows.flatMap((m) => (m.metadata?.message_ids ?? []).filter(Boolean)))];
          evidence.tags = [...new Set(usedRows.flatMap((m) => (m.metadata?.tags ?? []).filter(Boolean)))];
        }
      }
    } catch (embedErr) {
      console.warn('[ai-coach-chat] RAG embedding/match failed:', embedErr);
    }

    const acc7 =
      leakStats?.attempts_7d != null &&
      leakStats?.correct_7d != null &&
      leakStats.attempts_7d > 0
        ? Math.round((leakStats.correct_7d / leakStats.attempts_7d) * 100)
        : undefined;
    console.log(
      JSON.stringify({
        thread_id: threadId,
        leak_tag: effectiveLeakTag ?? undefined,
        rating: leakStats?.rating,
        acc7,
        top_mistakes: leakStats?.top_mistakes,
      })
    );

    const baseSystemPrompt = buildSystemPrompt(
      coachStyle,
      memoryLines,
      conversationBlock,
      effectiveLeakTag,
      leakStats
    );
    if (isContinue) {
      systemPrompt = baseSystemPrompt +
        '\n\nContinue your previous answer from where it stopped. Do not repeat. Here is the partial assistant text:\n\n' +
        partialAssistantText;
    } else {
      systemPrompt = baseSystemPrompt;
    }

    const useStream = body.stream !== false && req.headers.get('x-disable-stream') !== '1';

    const openaiUserContent = isContinue ? 'Продолжи.' : message;

    if (!useStream) {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: openaiUserContent },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        return json({ error: 'OpenAI request failed', detail: errText }, 502);
      }

      const openaiJson = (await openaiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const rawContent = openaiJson.choices?.[0]?.message?.content;
      const assistantContent = (typeof rawContent === 'string' ? rawContent : '').trim() || 'Нет ответа от тренера.';
      const finalContent = sanitizeLeakClaims(assistantContent, hasEvidence);

      const { data: assistantRow, error: insertAssistantError } = await supabaseUser
        .from('chat_messages')
        .insert({
          thread_id: threadId,
          user_id: userId,
          role: 'assistant',
          content: finalContent,
        })
        .select('id')
        .single();

      if (insertAssistantError) {
        return json({ error: 'Failed to save assistant reply', detail: insertAssistantError.message }, 500);
      }

      await supabaseUser
        .from('chat_threads')
        .update(
          shouldSetTitle ? { title: newTitle, updated_at: new Date().toISOString() } : { updated_at: new Date().toISOString() }
        )
        .eq('id', threadId)
        .eq('user_id', userId);

      return json({
        thread_id: threadId,
        assistant_message: { id: assistantRow?.id ?? '', content: finalContent },
        evidence,
      });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: openaiUserContent },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return json({ error: 'OpenAI request failed', detail: errText }, 502);
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = openaiRes.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: 'No response body' }) + '\n\n'));
          controller.close();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let streamDone = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') {
                streamDone = true;
                break;
              }
              try {
                const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
                const content = obj.choices?.[0]?.delta?.content;
                if (typeof content === 'string') {
                  fullContent += content;
                  controller.enqueue(encoder.encode('data: ' + JSON.stringify({ delta: content }) + '\n\n'));
                }
              } catch {
                // skip malformed line
              }
            }
            if (streamDone) break;
          }
          const assistantContent = fullContent.trim() || 'Нет ответа от тренера.';
          const finalContent = sanitizeLeakClaims(assistantContent, hasEvidence);

          const { data: assistantRow, error: insertAssistantError } = await supabaseUser
            .from('chat_messages')
            .insert({
              thread_id: threadId,
              user_id: userId,
              role: 'assistant',
              content: finalContent,
            })
            .select('id')
            .single();

          if (insertAssistantError) {
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: 'Failed to save assistant reply: ' + insertAssistantError.message }) + '\n\n'));
          } else {
            await supabaseUser
              .from('chat_threads')
              .update(
                shouldSetTitle ? { title: newTitle, updated_at: new Date().toISOString() } : { updated_at: new Date().toISOString() }
              )
              .eq('id', threadId)
              .eq('user_id', userId);

            controller.enqueue(encoder.encode('data: ' + JSON.stringify({
              done: true,
              thread_id: threadId,
              assistant_message_id: assistantRow?.id ?? '',
              final_content: finalContent,
              evidence,
            }) + '\n\n'));
          }
        } catch (err) {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: 'internal' }) + '\n\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return json(err.body, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: 'internal', detail: msg }, 500);
  }
});
