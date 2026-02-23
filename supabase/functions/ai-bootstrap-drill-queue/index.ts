import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const TARGET_COUNT = 10;
const FOCUS_SHARE = 0.7; // 70% for weekly focus
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIX_THRESHOLD = 0.1; // 10% difference to switch to sizingHeavy/actionHeavy
const MIN_ATTEMPTS_FOR_MIX = 10;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type SkillRatingRow = {
  leak_tag: string;
  rating: number;
  attempts_7d: number;
  correct_7d: number;
  last_practice_at: string | null;
};

/**
 * Compute priority score for weekly focus (higher = more need to practice).
 * base: low rating -> higher score
 * acc7: low 7d accuracy (when enough attempts) -> higher score
 * recency: not practiced recently or never -> bonus
 * volume: very few attempts -> bonus
 */
function scoreForFocus(row: SkillRatingRow, now: Date): number {
  const base = (100 - row.rating) / 100;
  const acc7 =
    row.attempts_7d >= 5
      ? 1 - row.correct_7d / Math.max(1, row.attempts_7d)
      : 0.15;
  const lastAt = row.last_practice_at ? new Date(row.last_practice_at).getTime() : null;
  const recency =
    lastAt == null ? 0.25 : (now.getTime() - lastAt > FOURTEEN_DAYS_MS ? 0.2 : 0);
  const volume = row.attempts_7d < 3 ? 0.1 : 0;
  return base + acc7 + recency + volume;
}

/**
 * Compute weekly focus leak_tag from skill_ratings (server-side, deterministic).
 * Falls back to 'fundamentals' if no data or invalid tag.
 */
function computeWeeklyFocus(rows: SkillRatingRow[]): string {
  if (!rows || rows.length === 0) return 'fundamentals';
  const now = new Date();
  let bestTag = rows[0].leak_tag;
  let bestScore = scoreForFocus(rows[0], now);
  for (let i = 1; i < rows.length; i++) {
    const s = scoreForFocus(rows[i], now);
    if (s > bestScore) {
      bestScore = s;
      bestTag = rows[i].leak_tag;
    }
  }
  const enforced = enforceAllowedLeakTag(bestTag);
  return enforced ?? 'fundamentals';
}

/**
 * Second tag for "other" slot: next by score (enforced) or 'fundamentals'.
 */
function computeOtherTag(rows: SkillRatingRow[], focusTag: string): string {
  if (!rows || rows.length === 0) return 'fundamentals';
  const now = new Date();
  const sorted = [...rows]
    .filter((r) => enforceAllowedLeakTag(r.leak_tag) !== focusTag)
    .map((r) => ({ tag: r.leak_tag, score: scoreForFocus(r, now) }))
    .sort((a, b) => b.score - a.score);
  const next = sorted[0]?.tag;
  const enforced = next ? enforceAllowedLeakTag(next) : null;
  return enforced ?? 'fundamentals';
}

type FocusMixMode = 'sizingHeavy' | 'actionHeavy' | 'balanced' | 'insufficientData';

type FocusMix = {
  mode: FocusMixMode;
  pct_sizing_used: number;
  focus_raise_sizing: number;
  focus_action_decision: number;
  /** For logging only; present when we had events data */
  attempts_action?: number;
  attempts_sizing?: number;
  mistakeRateAction?: number;
  mistakeRateSizing?: number;
  total_mistakes?: number;
  sizing_mistakes?: number;
  sizing_reason_share?: number;
};

type TrainingEventRow = { drill_type: string | null; is_correct: boolean; mistake_reason: string | null };

/**
 * Fetch focus leak_tag stats from training_events (last 30 days), then compute
 * preferred drill_type mix. On query failure or no data -> insufficientData, 50/50.
 * drill_type null in DB is treated as action_decision.
 */
async function getFocusMix(
  supabaseUser: any,
  userId: string,
  focusLeakTag: string,
  focusCount: number
): Promise<FocusMix> {
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  let attemptsAction = 0;
  let mistakesAction = 0;
  let attemptsSizing = 0;
  let mistakesSizing = 0;

  const { data: events, error } = await supabaseUser
    .from('training_events')
    .select('drill_type, is_correct, mistake_reason')
    .eq('user_id', userId)
    .eq('leak_tag', focusLeakTag)
    .gte('created_at', thirtyDaysAgo);

  if (error || !Array.isArray(events)) {
    const nSizing = Math.round(focusCount * 0.5);
    const nAction = focusCount - nSizing;
    return {
      mode: 'insufficientData',
      pct_sizing_used: 0.5,
      focus_raise_sizing: nSizing,
      focus_action_decision: nAction,
    };
  }

  // drill_type null -> treat as action_decision; mistake_reason null -> not counted as sizing
  let totalMistakes = 0;
  let sizingMistakes = 0;

  for (const row of events as TrainingEventRow[]) {
    const isAction = row.drill_type !== 'raise_sizing'; // null or action_decision -> action
    if (isAction) {
      attemptsAction += 1;
      if (!row.is_correct) {
        mistakesAction += 1;
        totalMistakes += 1;
        if (row.mistake_reason === 'sizing') sizingMistakes += 1;
      }
    } else {
      attemptsSizing += 1;
      if (!row.is_correct) {
        mistakesSizing += 1;
        totalMistakes += 1;
        if (row.mistake_reason === 'sizing') sizingMistakes += 1;
      }
    }
  }

  const sizingReasonShare = totalMistakes === 0 ? 0 : sizingMistakes / totalMistakes;

  const attemptsTotal = attemptsAction + attemptsSizing;
  if (attemptsTotal < MIN_ATTEMPTS_FOR_MIX) {
    const nSizing = Math.round(focusCount * 0.5);
    const nAction = focusCount - nSizing;
    return {
      mode: 'insufficientData',
      pct_sizing_used: 0.5,
      focus_raise_sizing: nSizing,
      focus_action_decision: nAction,
      total_mistakes: totalMistakes,
      sizing_mistakes: sizingMistakes,
      sizing_reason_share: sizingReasonShare,
    };
  }

  const mistakeRateAction = mistakesAction / Math.max(1, attemptsAction);
  const mistakeRateSizing = mistakesSizing / Math.max(1, attemptsSizing);
  const diffSizingMinusAction = mistakeRateSizing - mistakeRateAction;
  const diffActionMinusSizing = mistakeRateAction - mistakeRateSizing;

  let mode: FocusMixMode = 'balanced';
  let pctSizing = 0.5;
  if (diffSizingMinusAction >= MIX_THRESHOLD) {
    mode = 'sizingHeavy';
    pctSizing = 0.7;
  } else if (diffActionMinusSizing >= MIX_THRESHOLD) {
    mode = 'actionHeavy';
    pctSizing = 0.3;
  }

  // Correction by mistake_reason for focus leak: reinforce sizingHeavy or actionHeavy
  if (totalMistakes >= 6) {
    if (sizingReasonShare >= 0.45) {
      mode = 'sizingHeavy';
      pctSizing = Math.max(pctSizing, 0.8);
    } else if (sizingReasonShare <= 0.15) {
      mode = 'actionHeavy';
      pctSizing = Math.min(pctSizing, 0.2);
    }
  }

  const focus_raise_sizing = Math.round(focusCount * pctSizing);
  const focus_action_decision = focusCount - focus_raise_sizing;

  return {
    mode,
    pct_sizing_used: pctSizing,
    focus_raise_sizing,
    focus_action_decision,
    attempts_action: attemptsAction,
    attempts_sizing: attemptsSizing,
    mistakeRateAction,
    mistakeRateSizing,
    total_mistakes: totalMistakes,
    sizing_mistakes: sizingMistakes,
    sizing_reason_share: sizingReasonShare,
  };
}

/**
 * Build deterministic list of drill_type for focus slots: majority first, then minority.
 * e.g. sizingHeavy focusCount=7 -> [raise_sizing x 5, action_decision x 2].
 */
function buildFocusDrillTypes(mix: FocusMix): string[] {
  const a: string[] = [];
  const nSizing = mix.focus_raise_sizing;
  const nAction = mix.focus_action_decision;
  for (let i = 0; i < nSizing; i++) a.push('raise_sizing');
  for (let i = 0; i < nAction; i++) a.push('action_decision');
  return a;
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

    const { count: activeCount, error: countError } = await supabaseUser
      .from('drill_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['due', 'scheduled']);

    if (countError) {
      return json({ error: 'db_error', detail: countError.message }, 500);
    }

    const hasActive = (activeCount ?? 0) > 0;
    if (hasActive) {
      const payload = {
        ok: true,
        focus_leak_tag: 'fundamentals',
        created: 0,
        breakdown: { focus: 0, other: 0 },
        focus_mix: {
          mode: 'insufficientData' as const,
          pct_sizing_used: 0.5,
          focus_raise_sizing: 0,
          focus_action_decision: 0,
          total_mistakes: 0,
          sizing_mistakes: 0,
          sizing_reason_share: 0,
        },
      };
      console.log(
        JSON.stringify({
          user_id: userId,
          focus_leak_tag: payload.focus_leak_tag,
          created: 0,
          breakdown: payload.breakdown,
        })
      );
      return json(payload);
    }

    let skillRows: SkillRatingRow[] = [];
    const { data: skillData, error: skillError } = await supabaseUser
      .from('skill_ratings')
      .select('leak_tag, rating, attempts_7d, correct_7d, last_practice_at')
      .eq('user_id', userId);

    if (skillError) {
      console.error('skill_ratings fetch failed, using fundamentals:', skillError.message);
    } else if (skillData && Array.isArray(skillData)) {
      skillRows = skillData as SkillRatingRow[];
    }

    const focusLeakTag = computeWeeklyFocus(skillRows);
    const otherTag = computeOtherTag(skillRows, focusLeakTag);

    const focusCount = Math.floor(TARGET_COUNT * FOCUS_SHARE);
    const otherCount = TARGET_COUNT - focusCount;
    const now = new Date().toISOString();

    const mix = await getFocusMix(supabaseUser, userId, focusLeakTag, focusCount);
    const focusDrillTypes = buildFocusDrillTypes(mix);

    const rows: Array<{
      user_id: string;
      leak_tag: string;
      status: string;
      due_at: string;
      repetition: number;
      last_score: number | null;
      last_drill_id: null;
      drill_type: string;
    }> = [];
    for (let f = 0; f < focusCount; f++) {
      rows.push({
        user_id: userId,
        leak_tag: focusLeakTag,
        status: 'due',
        due_at: now,
        repetition: 0,
        last_score: null,
        last_drill_id: null,
        drill_type: focusDrillTypes[f],
      });
    }
    for (let o = 0; o < otherCount; o++) {
      rows.push({
        user_id: userId,
        leak_tag: otherTag,
        status: 'due',
        due_at: now,
        repetition: 0,
        last_score: null,
        last_drill_id: null,
        drill_type: o % 2 === 0 ? 'action_decision' : 'raise_sizing',
      });
    }

    const { error: insertError } = await supabaseUser.from('drill_queue').insert(rows);

    if (insertError) {
      return json({ error: 'db_error', detail: insertError.message }, 500);
    }

    const breakdown = { focus: focusCount, other: otherCount };
    const focus_mix = {
      mode: mix.mode,
      pct_sizing_used: mix.pct_sizing_used,
      focus_raise_sizing: mix.focus_raise_sizing,
      focus_action_decision: mix.focus_action_decision,
      attempts_action: mix.attempts_action,
      attempts_sizing: mix.attempts_sizing,
      mistakeRateAction: mix.mistakeRateAction,
      mistakeRateSizing: mix.mistakeRateSizing,
      total_mistakes: mix.total_mistakes,
      sizing_mistakes: mix.sizing_mistakes,
      sizing_reason_share: mix.sizing_reason_share,
    };
    const payload = {
      ok: true,
      focus_leak_tag: focusLeakTag,
      created: rows.length,
      breakdown,
      focus_mix,
    };
    console.log(
      JSON.stringify({
        user_id: userId,
        focusLeakTag,
        mix_mode: mix.mode,
        attempts_action: mix.attempts_action,
        attempts_sizing: mix.attempts_sizing,
        mistakeRateAction: mix.mistakeRateAction,
        mistakeRateSizing: mix.mistakeRateSizing,
        total_mistakes: mix.total_mistakes,
        sizing_mistakes: mix.sizing_mistakes,
        sizing_reason_share: mix.sizing_reason_share,
        pct_sizing_used: mix.pct_sizing_used,
      })
    );
    return json(payload);
  } catch (e) {
    if (e instanceof AuthError) {
      return json({ error: e.body?.error ?? 'auth_error', detail: e.body?.detail }, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: 'server_error', detail: msg }, 500);
  }
});
