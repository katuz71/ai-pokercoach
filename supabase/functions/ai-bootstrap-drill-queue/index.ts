import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceAllowedLeakTag } from '../_shared/leaks.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const TARGET_COUNT = 10;
const FOCUS_SHARE = 0.7; // 70% for weekly focus
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Fallback when leaks array is empty — at least 10 rows in drill_queue */
const FALLBACK_LEAKS = [
  'preflop_opening',
  'flop_cbet',
  'turn_barreling',
  'river_betting_strategy',
  'defense_vs_cbet',
];
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

type BootstrapResponse = {
  ok: boolean;
  user_id: string;
  existing_before: number;
  inserted_count: number;
  used_fallback_seed: boolean;
  sample: Array<{ id: string; status: string; due_at: string; leak_tag: string }>;
  error?: string;
  reason?: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed', detail: 'Use POST' }, 405);
  }

  let userId: string;
  try {
    const auth = await requireUserClient(req);
    userId = auth.userId;
  } catch (e) {
    if (e instanceof AuthError) {
      return json({ error: e.body?.error ?? 'auth_error', detail: e.body?.detail }, e.status);
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: 'server_error', detail: msg }, 500);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('bootstrap failed', { user_id: userId, error: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    const res: BootstrapResponse = {
      ok: false,
      user_id: userId,
      existing_before: 0,
      inserted_count: 0,
      used_fallback_seed: false,
      sample: [],
      error: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      reason: 'env',
    };
    return json(res, 500);
  }

  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  // Table: drill_queue, column: user_id (confirmed in migrations)
  const { count: activeCount, error: countError } = await supabaseService
    .from('drill_queue')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['due', 'scheduled']);

  if (countError) {
    console.error('bootstrap failed', { user_id: userId, error: countError.message });
    const res: BootstrapResponse = {
      ok: false,
      user_id: userId,
      existing_before: 0,
      inserted_count: 0,
      used_fallback_seed: false,
      sample: [],
      error: String(countError.message),
      reason: 'count',
    };
    return json(res, 500);
  }

  const existingBefore = activeCount ?? 0;
  if (existingBefore > 0) {
    const res: BootstrapResponse = {
      ok: true,
      user_id: userId,
      existing_before: existingBefore,
      inserted_count: 0,
      used_fallback_seed: false,
      sample: [],
    };
    return json(res);
  }

  // Determine leaks: from skill_ratings or fallback
  let skillRows: SkillRatingRow[] = [];
  const { data: skillData, error: skillError } = await supabaseService
    .from('skill_ratings')
    .select('leak_tag, rating, attempts_7d, correct_7d, last_practice_at')
    .eq('user_id', userId);

  if (!skillError && skillData && Array.isArray(skillData)) {
    skillRows = skillData as SkillRatingRow[];
  }

  const focusLeakTag = computeWeeklyFocus(skillRows);
  const otherTag = computeOtherTag(skillRows, focusLeakTag);
  const focusCount = Math.floor(TARGET_COUNT * FOCUS_SHARE);
  const otherCount = TARGET_COUNT - focusCount;

  let used_fallback_seed: boolean;
  let leakTags: string[];

  if (!skillRows || skillRows.length === 0) {
    used_fallback_seed = true;
    leakTags = FALLBACK_LEAKS;
  } else {
    used_fallback_seed = false;
    leakTags = [];
    for (let i = 0; i < focusCount; i++) leakTags.push(focusLeakTag);
    for (let i = 0; i < otherCount; i++) leakTags.push(otherTag);
  }

  const dueAt = new Date().toISOString();
  const rows = Array.from({ length: TARGET_COUNT }, (_, i) => ({
    user_id: userId,
    status: 'due',
    due_at: dueAt,
    leak_tag: leakTags[i % leakTags.length],
    drill_type: 'action_decision' as const,
    repetition: 0,
    last_score: null as number | null,
    last_drill_id: null as null,
  }));

  const { error: insertError } = await supabaseService
    .from('drill_queue')
    .insert(rows);

  if (insertError) {
    console.error('bootstrap failed', { user_id: userId, error: insertError.message });
    const res: BootstrapResponse = {
      ok: false,
      user_id: userId,
      existing_before: existingBefore,
      inserted_count: 0,
      used_fallback_seed,
      sample: [],
      error: String(insertError.message),
      reason: 'insert',
    };
    return json(res, 500);
  }

  const { data: sampleRows, error: selectError } = await supabaseService
    .from('drill_queue')
    .select('id, status, due_at, leak_tag')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (selectError) {
    console.error('bootstrap failed', { user_id: userId, error: selectError.message });
    const res: BootstrapResponse = {
      ok: false,
      user_id: userId,
      existing_before: existingBefore,
      inserted_count: rows.length,
      used_fallback_seed,
      sample: [],
      error: String(selectError.message),
      reason: 'select_after_insert',
    };
    return json(res, 500);
  }

  const sample = (sampleRows ?? []).map((r: { id: string; status: string; due_at: string; leak_tag: string }) => ({
    id: r.id,
    status: r.status,
    due_at: r.due_at,
    leak_tag: r.leak_tag,
  }));

  const res: BootstrapResponse = {
    ok: true,
    user_id: userId,
    existing_before: existingBefore,
    inserted_count: rows.length,
    used_fallback_seed,
    sample,
  };
  return json(res);
});
