import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const VALID_ACTIONS = ['fold', 'call', 'raise'] as const;
type UserAction = (typeof VALID_ACTIONS)[number];

/** Interval days by repetition index: 1,2,3,5,8,13,14 capped */
const INTERVAL_DAYS = [1, 2, 3, 5, 8, 13, 14];

type TableDrillScenario = {
  game?: string;
  hero_pos?: string;
  villain_pos?: string;
  effective_stack_bb?: number;
  hero_cards?: [string, string];
  board?: { flop: [string, string, string]; turn: string | null; river: string | null };
  pot_bb?: number;
  street?: string;
  action_to_hero?: { type: string; size_bb: number };
  correct_action: 'fold' | 'call' | 'raise';
  explanation: string;
  [k: string]: unknown;
};

type SubmitRequest = {
  drill_queue_id: string;
  scenario: TableDrillScenario;
  user_action: UserAction;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(error: string, detail?: string, status = 400) {
  return json({ error, ...(detail ? { detail } : {}) }, status);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { userId, supabaseUser } = await requireUserClient(req);

    let body: SubmitRequest;
    try {
      body = (await req.json()) as SubmitRequest;
    } catch {
      return err('Invalid JSON');
    }

    const { drill_queue_id, scenario, user_action } = body;
    if (!drill_queue_id || !scenario || !user_action) {
      return err('Missing required fields: drill_queue_id, scenario, user_action');
    }

    const correctAction = scenario.correct_action;
    if (!correctAction || !VALID_ACTIONS.includes(correctAction as UserAction)) {
      return err('scenario.correct_action must be one of fold, call, raise');
    }
    if (!VALID_ACTIONS.includes(user_action)) {
      return err('user_action must be one of fold, call, raise');
    }

    const { data: queueRow, error: selectError } = await supabaseUser
      .from('drill_queue')
      .select('id, user_id, leak_tag, repetition')
      .eq('id', drill_queue_id)
      .single();

    if (selectError || !queueRow || queueRow.user_id !== userId) {
      return err('drill_queue not found or access denied', selectError?.message, 404);
    }

    const correct = user_action === correctAction;
    const leak_tag = queueRow.leak_tag ?? 'fundamentals';
    const enforcedLeakTag = enforceAllowedLeakTag(leak_tag) ?? 'fundamentals';

    const now = new Date().toISOString();

    const { data: insertedEvent, error: insertError } = await supabaseUser
      .from('training_events')
      .insert({
        user_id: userId,
        scenario: scenario as Record<string, unknown>,
        user_action,
        correct_action: correctAction,
        mistake_tag: correct ? null : enforcedLeakTag,
      })
      .select('id')
      .single();

    if (insertError || !insertedEvent?.id) {
      console.error('training_events insert failed:', insertError);
      return json({ error: 'Failed to save training event', detail: insertError?.message }, 500);
    }

    const eventId = insertedEvent.id;
    const repetition = (queueRow.repetition ?? 0) | 0;

    if (correct) {
      const newRep = repetition + 1;
      const daysIndex = Math.min(newRep - 1, INTERVAL_DAYS.length - 1);
      const days = INTERVAL_DAYS[daysIndex] ?? 14;
      const nextDue = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const { error: updateError } = await supabaseUser
        .from('drill_queue')
        .update({
          repetition: newRep,
          status: 'scheduled',
          due_at: nextDue,
          last_score: 100,
          last_drill_id: eventId,
          updated_at: now,
        })
        .eq('id', drill_queue_id);

      if (updateError) {
        console.error('drill_queue update (correct) failed:', updateError);
      }

      return json({
        ok: true,
        correct: true,
        explanation: scenario.explanation ?? '',
        next_due_at: nextDue,
        repetition: newRep,
      });
    }

    const dueAtIn10Min = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: updateError } = await supabaseUser
      .from('drill_queue')
      .update({
        repetition: 0,
        status: 'due',
        due_at: dueAtIn10Min,
        last_score: 0,
        last_drill_id: eventId,
        updated_at: now,
      })
      .eq('id', drill_queue_id);

    if (updateError) {
      console.error('drill_queue update (incorrect) failed:', updateError);
    }

    return json({
      ok: true,
      correct: false,
      explanation: scenario.explanation ?? '',
      next_due_at: dueAtIn10Min,
      repetition: 0,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
