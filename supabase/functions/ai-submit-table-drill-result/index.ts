import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const VALID_ACTIONS = ['fold', 'call', 'raise'] as const;
type UserAction = (typeof VALID_ACTIONS)[number];

const RAISE_SIZING_OPTIONS = ['2.5x', '3x', 'overbet'] as const;
type RaiseSizingOption = (typeof RAISE_SIZING_OPTIONS)[number];

const VALID_MISTAKE_REASONS = ['range', 'sizing', 'position', 'board', 'stack', 'unknown'] as const;
type MistakeReason = (typeof VALID_MISTAKE_REASONS)[number];

function normalizeMistakeReason(
  value: unknown,
  isCorrect: boolean,
): string | null {
  if (isCorrect) return null;
  if (value == null || value === '') return 'unknown';
  const s = String(value).toLowerCase().trim();
  if (VALID_MISTAKE_REASONS.includes(s as MistakeReason)) return s;
  return 'unknown';
}

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
  correct_action?: 'fold' | 'call' | 'raise';
  correct_option?: string;
  explanation: string;
  drill_type?: 'action_decision' | 'raise_sizing';
  [k: string]: unknown;
};

type SubmitRequest = {
  /** When true: only update mistake_reason for existing event. Payload: training_event_id, mistake_reason */
  update_reason_only?: boolean;
  training_event_id?: string;
  mistake_reason?: string;
  drill_queue_id?: string;
  scenario?: TableDrillScenario;
  /** Legacy: fold | call | raise for action_decision */
  user_action?: UserAction;
  /** Generic: fold/call/raise or 2.5x/3x/overbet */
  user_answer?: string;
  drill_type?: 'action_decision' | 'raise_sizing';
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

/** Call rpc_update_skill_rating if leak_tag is non-empty; return skill_rating payload or null. */
async function updateSkillRatingIfAllowed(
  supabaseUser: { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  leakTag: string,
  isCorrect: boolean,
  practicedAt: string,
): Promise<{
  leak_tag: string;
  rating: number;
  streak_correct: number;
  attempts_7d: number;
  correct_7d: number;
  attempts_30d: number;
  correct_30d: number;
  total_attempts: number;
  total_correct: number;
  last_practice_at: string | null;
  last_mistake_at: string | null;
} | null> {
  if (leakTag == null || String(leakTag).trim() === '') {
    return null;
  }
  try {
    const { data: row, error } = await supabaseUser.rpc('rpc_update_skill_rating', {
      p_leak_tag: leakTag,
      p_is_correct: isCorrect,
      p_practiced_at: practicedAt,
    });
    if (error || row == null) {
      console.error('rpc_update_skill_rating failed:', error);
      return null;
    }
    const r = row as Record<string, unknown>;
    return {
      leak_tag: String(r.leak_tag ?? leakTag),
      rating: Number(r.rating ?? 50),
      streak_correct: Number(r.streak_correct ?? 0),
      attempts_7d: Number(r.attempts_7d ?? 0),
      correct_7d: Number(r.correct_7d ?? 0),
      attempts_30d: Number(r.attempts_30d ?? 0),
      correct_30d: Number(r.correct_30d ?? 0),
      total_attempts: Number(r.total_attempts ?? 0),
      total_correct: Number(r.total_correct ?? 0),
      last_practice_at: r.last_practice_at != null ? String(r.last_practice_at) : null,
      last_mistake_at: r.last_mistake_at != null ? String(r.last_mistake_at) : null,
    };
  } catch (e) {
    console.error('updateSkillRatingIfAllowed error:', e);
    return null;
  }
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

    // update_reason_only: idempotent update of mistake_reason for existing event
    if (body.update_reason_only === true) {
      const eventId = body.training_event_id;
      const rawReason = body.mistake_reason;
      if (!eventId) {
        return json({ ok: true });
      }
      const reason = rawReason == null || rawReason === ''
        ? 'unknown'
        : (VALID_MISTAKE_REASONS.includes(String(rawReason).toLowerCase().trim() as MistakeReason)
          ? String(rawReason).toLowerCase().trim()
          : 'unknown');
      const { error: updateErr } = await supabaseUser
        .from('training_events')
        .update({ mistake_reason: reason })
        .eq('id', eventId)
        .eq('user_id', userId);
      if (updateErr) console.error('update_reason_only failed:', updateErr);
      return json({ ok: true });
    }

    const { drill_queue_id, scenario, user_action, user_answer: bodyUserAnswer, drill_type: bodyDrillType, mistake_reason: bodyMistakeReason } = body;
    if (!drill_queue_id || !scenario) {
      return err('Missing required fields: drill_queue_id, scenario');
    }

    const drillType = bodyDrillType ?? scenario.drill_type ?? 'action_decision';
    let userAnswer: string;
    let correctAnswer: string;

    if (drillType === 'raise_sizing') {
      const correctOption = scenario.correct_option;
      if (!correctOption || !RAISE_SIZING_OPTIONS.includes(correctOption as RaiseSizingOption)) {
        return err('scenario.correct_option must be one of 2.5x, 3x, overbet');
      }
      const ua = bodyUserAnswer ?? body.user_answer;
      if (!ua || !RAISE_SIZING_OPTIONS.includes(ua as RaiseSizingOption)) {
        return err('user_answer must be one of 2.5x, 3x, overbet for raise_sizing');
      }
      userAnswer = ua;
      correctAnswer = correctOption;
    } else {
      const correctAction = scenario.correct_action;
      if (!correctAction || !VALID_ACTIONS.includes(correctAction as UserAction)) {
        return err('scenario.correct_action must be one of fold, call, raise');
      }
      const ua = user_action ?? bodyUserAnswer ?? body.user_answer;
      if (!ua || !VALID_ACTIONS.includes(ua as UserAction)) {
        return err('user_action or user_answer must be one of fold, call, raise');
      }
      userAnswer = ua;
      correctAnswer = correctAction;
    }

    const { data: queueRow, error: selectError } = await supabaseUser
      .from('drill_queue')
      .select('id, user_id, leak_tag, repetition')
      .eq('id', drill_queue_id)
      .single();

    if (selectError || !queueRow || queueRow.user_id !== userId) {
      return err('drill_queue not found or access denied', selectError?.message, 404);
    }

    const correct = userAnswer === correctAnswer;
    const leak_tag = queueRow.leak_tag ?? 'fundamentals';
    const enforcedLeakTag = enforceAllowedLeakTag(leak_tag) ?? 'fundamentals';
    const mistake_reason = normalizeMistakeReason(bodyMistakeReason, correct);

    const now = new Date().toISOString();

    const { data: insertedEvent, error: insertError } = await supabaseUser
      .from('training_events')
      .insert({
        user_id: userId,
        scenario: scenario as Record<string, unknown>,
        user_action: userAnswer,
        correct_action: correctAnswer,
        mistake_tag: correct ? null : enforcedLeakTag,
        is_correct: correct,
        leak_tag: enforcedLeakTag,
        drill_type: drillType,
        user_answer: userAnswer,
        correct_answer: correctAnswer,
        mistake_reason,
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

      const baseResponse = {
        ok: true,
        correct: true,
        explanation: scenario.explanation ?? '',
        next_due_at: nextDue,
        repetition: newRep,
        training_event_id: eventId,
      };
      const skillRating = await updateSkillRatingIfAllowed(supabaseUser, enforcedLeakTag, correct, now);
      return json(skillRating != null ? { ...baseResponse, skill_rating: skillRating } : baseResponse);
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

    const baseResponse = {
      ok: true,
      correct: false,
      explanation: scenario.explanation ?? '',
      next_due_at: dueAtIn10Min,
      repetition: 0,
      training_event_id: eventId,
    };
    const skillRating = await updateSkillRatingIfAllowed(supabaseUser, enforcedLeakTag, correct, now);
    return json(skillRating != null ? { ...baseResponse, skill_rating: skillRating } : baseResponse);
  } catch (e) {
    if (e instanceof AuthError) {
      return json(e.body, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
