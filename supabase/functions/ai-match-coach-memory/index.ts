import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient } from '../_shared/userAuth.ts';

type Body = {
  query_text: string;
  match_count?: number;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY' }, 500);
    }

    const body = (await req.json()) as Body;
    const queryText = typeof body.query_text === 'string' ? body.query_text.trim() : '';
    const matchCount = typeof body.match_count === 'number' ? Math.min(10, Math.max(1, body.match_count)) : 3;

    if (!queryText) {
      return json({ matches: [] });
    }

    const embedding = await getEmbedding(openAiKey, queryText);
    const { data: matches, error } = await supabaseUser.rpc('match_coach_memory', {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: matchCount,
      filter_user_id: userId,
    });

    if (error) {
      console.warn('[ai-match-coach-memory] RPC error:', error);
      return json({ error: error.message, matches: [] }, 400);
    }

    return json({ matches: matches ?? [] });
  } catch (e) {
    console.error('[ai-match-coach-memory]', e);
    return json(
      { error: e instanceof Error ? e.message : 'Internal error', matches: [] },
      500
    );
  }
});
