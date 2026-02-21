import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Extract up to 3 unique allowed leak tags from summary.top_leaks (array of { tag?, ... }) */
function topLeakTagsFromSummary(summary: any): string[] {
  const topLeaks = summary?.top_leaks;
  if (!Array.isArray(topLeaks) || topLeaks.length === 0) return ['fundamentals'];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of topLeaks) {
    if (out.length >= 3) break;
    const raw = item?.tag ?? item?.name ?? (typeof item === 'string' ? item : null);
    if (raw == null) continue;
    const tag = enforceAllowedLeakTag(String(raw));
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  if (out.length === 0) return ['fundamentals'];
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed', detail: 'Use POST' }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);

    const { count: existingCount, error: countError } = await supabaseUser
      .from('drill_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['due', 'scheduled']);

    if (countError) {
      return json({ error: 'db_error', detail: countError.message }, 500);
    }

    const hasExisting = (existingCount ?? 0) > 0;
    if (hasExisting) {
      return json({ ok: true, created: 0 });
    }

    const { data: summaryRow, error: summaryError } = await supabaseUser
      .from('leak_summaries')
      .select('summary')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (summaryError) {
      return json({ error: 'db_error', detail: summaryError.message }, 500);
    }

    const leakTags = topLeakTagsFromSummary(summaryRow?.summary ?? null);
    const now = new Date().toISOString();

    const rows = leakTags.map((leak_tag) => ({
      user_id: userId,
      leak_tag,
      status: 'due',
      due_at: now,
      repetition: 0,
      last_score: null,
      last_drill_id: null,
      updated_at: now,
    }));

    const { error: insertError } = await supabaseUser.from('drill_queue').insert(rows);

    if (insertError) {
      return json({ error: 'db_error', detail: insertError.message }, 500);
    }

    return json({ ok: true, created: rows.length, leak_tags: leakTags });
  } catch (e) {
    if (e instanceof AuthError) {
      return json({ error: e.body?.error ?? 'auth_error', detail: e.body?.detail }, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: 'server_error', detail: msg }, 500);
  }
});
