// @ts-nocheck — Supabase Edge Functions run on Deno; type-check with Deno or supabase functions serve
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

type ActionPlanItemType = 'analyze' | 'drill' | 'checkin' | 'manual';

type ActionPlanItem = {
  id: string;
  text: string;
  done: boolean;
  type?: ActionPlanItemType;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    // Calculate today's boundaries in UTC
    const now = new Date();
    const startOfTodayUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0, 0, 0, 0
    )).toISOString();

    const endOfTodayUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0, 0
    )).toISOString();

    const todayDateUTC = now.toISOString().slice(0, 10); // YYYY-MM-DD

    console.log('[ai-sync-action-plan] todayUTC:', todayDateUTC);
    console.log('[ai-sync-action-plan] window:', startOfTodayUTC, '→', endOfTodayUTC);

    // Find current action plan for this week
    const { data: planData, error: planError } = await supabaseUser
      .from('action_plans')
      .select('id, period_start, period_end, focus_tag, items')
      .eq('user_id', userId)
      .lte('period_start', todayDateUTC)
      .gte('period_end', todayDateUTC)
      .maybeSingle();

    if (planError) {
      return json({ error: 'Failed to fetch action plan', detail: planError.message }, 500);
    }

    if (!planData) {
      return json({ error: 'plan_not_found', message: 'No action plan for current week' }, 404);
    }

    const items = planData.items as ActionPlanItem[];

    // Check for activity today - use count from queries
    // Check hand_analyses
    const { count: handsCount, error: handError } = await supabaseUser
      .from('hand_analyses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', startOfTodayUTC)
      .lt('created_at', endOfTodayUTC);

    // Check training_events
    const { count: drillsCount, error: drillError } = await supabaseUser
      .from('training_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', startOfTodayUTC)
      .lt('created_at', endOfTodayUTC);

    // Check daily_checkins
    const { count: checkinsCount, error: checkinError } = await supabaseUser
      .from('daily_checkins')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('checkin_date', todayDateUTC);

    console.log('[ai-sync-action-plan] counts:', {
      hands: handsCount,
      drills: drillsCount,
      checkins: checkinsCount,
    });

    // Update items based on activity
    let updatedAny = false;
    
    const updatedItems = items.map(item => {
      if (item.done) return item; // Already done, skip

      if (item.type === 'analyze' && (handsCount ?? 0) > 0) {
        updatedAny = true;
        return { ...item, done: true };
      }
      if (item.type === 'drill' && (drillsCount ?? 0) > 0) {
        updatedAny = true;
        return { ...item, done: true };
      }
      if (item.type === 'checkin' && (checkinsCount ?? 0) > 0) {
        updatedAny = true;
        return { ...item, done: true };
      }

      return item;
    });

    // Log sync results
    console.log('[ai-sync-action-plan] updated:', updatedAny);

    // Save updated items if any changes
    if (updatedAny) {
      const { error: updateError } = await supabaseUser
        .from('action_plans')
        .update({ items: updatedItems })
        .eq('id', planData.id);

      if (updateError) {
        return json({ error: 'Failed to update action plan', detail: updateError.message }, 500);
      }
    }

    // Return full action plan response
    return json({
      plan_id: planData.id,
      period_start: planData.period_start,
      period_end: planData.period_end,
      focus_tag: planData.focus_tag || '',
      items: updatedItems,
      synced: updatedAny,
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
