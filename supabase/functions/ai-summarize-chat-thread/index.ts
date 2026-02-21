import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type SummarizeBody = {
  thread_id: string;
  max_messages?: number;
};

type ChatMessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

type MemoryCandidate = {
  type: 'chat_fact' | 'chat_preference' | 'chat_goal' | 'chat_leak' | 'note';
  content: string;
  evidence_message_ids: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  tags?: string[];
};

type OpenAIResponse = {
  memories: MemoryCandidate[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

function mergeMessageIds(a: string[] | undefined, b: string[]): string[] {
  const set = new Set<string>([...(a ?? []), ...b]);
  return Array.from(set);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return json({ error: 'Unsupported content type', detail: 'Use application/json' }, 400);
    }

    let body: SummarizeBody;
    try {
      body = (await req.json()) as SummarizeBody;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return json({ error: 'Invalid JSON body', detail: msg }, 400);
    }

    const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
    if (!threadId) {
      return json({ error: 'thread_id_required', detail: 'thread_id is required' }, 400);
    }

    const maxMessages = typeof body.max_messages === 'number' && body.max_messages > 0
      ? Math.min(body.max_messages, 100)
      : 40;

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const { data: thread, error: threadError } = await supabaseUser
      .from('chat_threads')
      .select('id')
      .eq('id', threadId)
      .eq('user_id', userId)
      .maybeSingle();

    if (threadError || !thread) {
      return json({ error: 'thread_not_found', detail: 'Thread not found or access denied' }, 404);
    }

    const { data: rows, error: messagesError } = await supabaseUser
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(maxMessages);

    if (messagesError) {
      return json({ error: 'Failed to load messages', detail: messagesError.message }, 500);
    }

    const messages = (rows ?? []) as ChatMessageRow[];
    const userMessageIds = new Set(messages.filter((m) => m.role === 'user').map((m) => m.id));

    if (userMessageIds.size === 0) {
      return json({ thread_id: threadId, saved: 0, skipped: 0 });
    }

    const conversationText = messages
      .map((m) => `[id=${m.id} role=${m.role}]: ${m.content}`)
      .join('\n');

    const schemaPrompt = `Строго верни один JSON-объект без markdown и без комментариев, в формате:
{
  "memories": [
    {
      "type": "chat_fact|chat_preference|chat_goal|chat_leak|note",
      "content": "короткая формулировка 1-2 предложения",
      "evidence_message_ids": ["uuid сообщения пользователя", "..."],
      "confidence": "LOW|MEDIUM|HIGH",
      "tags": ["опционально для leak"]
    }
  ]
}
Правила: evidence_message_ids — только id сообщений с role=user из списка выше. Не выдумывай id. Если нет достаточного основания — не добавляй память. Запрещены медицинские или чувствительные личные догадки.`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Ты извлекаешь структурированные факты из диалога покер-тренера с игроком. Отвечай только валидным JSON.',
          },
          {
            role: 'user',
            content: `Диалог:\n${conversationText}\n\n${schemaPrompt}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return json({ error: 'OpenAI request failed', detail: errText }, 502);
    }

    const payload = (await openaiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = payload.choices?.[0]?.message?.content?.trim() ?? '';

    let parsed: OpenAIResponse;
    try {
      const cleaned = rawContent.replace(/^```\w*\n?|\n?```$/g, '').trim();
      parsed = JSON.parse(cleaned) as OpenAIResponse;
    } catch {
      return json({ error: 'Invalid OpenAI response', detail: 'Response was not valid JSON' }, 502);
    }

    const candidates = Array.isArray(parsed.memories) ? parsed.memories : [];
    const validTypes = ['chat_fact', 'chat_preference', 'chat_goal', 'chat_leak', 'note'];
    const validConfidence = ['LOW', 'MEDIUM', 'HIGH'];

    let saved = 0;
    let skipped = 0;

    for (const mem of candidates) {
      const type = validTypes.includes(mem.type) ? mem.type : 'note';
      const content = typeof mem.content === 'string' ? mem.content.trim() : '';
      if (!content) {
        skipped += 1;
        continue;
      }

      const evidenceIds = Array.isArray(mem.evidence_message_ids)
        ? (mem.evidence_message_ids as string[]).filter((id) => userMessageIds.has(String(id)))
        : [];
      const confidence = validConfidence.includes(mem.confidence) ? mem.confidence : 'MEDIUM';
      const tags = Array.isArray(mem.tags) ? (mem.tags as string[]) : [];

      const metadata = {
        source: 'coach_chat',
        thread_id: threadId,
        message_ids: evidenceIds,
        confidence,
        tags,
      };

      const { data: existing } = await supabaseUser
        .from('coach_memory')
        .select('id, metadata')
        .eq('user_id', userId)
        .eq('type', type)
        .eq('content', content)
        .maybeSingle();

      if (existing) {
        const existingMeta = (existing.metadata as { message_ids?: string[] }) ?? {};
        const mergedIds = mergeMessageIds(existingMeta.message_ids, evidenceIds);
        const { error: updateErr } = await supabaseUser
          .from('coach_memory')
          .update({
            metadata: { ...existingMeta, message_ids: mergedIds },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (!updateErr) saved += 1;
        else skipped += 1;
        continue;
      }

      let embedding: number[];
      try {
        embedding = await getEmbedding(openAiKey, content);
      } catch {
        skipped += 1;
        continue;
      }

      const { error: insertErr } = await supabaseUser.from('coach_memory').insert({
        user_id: userId,
        type,
        content,
        metadata,
        embedding,
      });

      if (!insertErr) saved += 1;
      else skipped += 1;
    }

    return json({ thread_id: threadId, saved, skipped });
  } catch (err) {
    if (err instanceof AuthError) {
      return json(err.body, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: 'internal', detail: msg }, 500);
  }
});
