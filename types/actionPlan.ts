// Action Plan types

export type ActionPlanItemType = 'analyze' | 'drill' | 'checkin' | 'manual';

export type ActionPlanItem = {
  id: string; // 'day1', 'day2', etc.
  text: string;
  done: boolean;
  type?: ActionPlanItemType; // Optional: auto-trackable types
};

export type ActionPlan = {
  id: string;
  user_id: string;
  period_start: string; // date as ISO string (YYYY-MM-DD)
  period_end: string; // date as ISO string (YYYY-MM-DD)
  focus_tag: string | null;
  items: ActionPlanItem[];
  created_at: string;
  updated_at: string;
};

export type ActionPlanResponse = {
  plan_id: string;
  period_start: string;
  period_end: string;
  focus_tag: string;
  items: ActionPlanItem[];
};
