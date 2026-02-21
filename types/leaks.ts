// Leak aggregation types

export type LeakTag = string;

export type TopLeak = {
  tag: string;
  count: number;
  explanation: string;
};

export type LeakSummary = {
  top_leaks: TopLeak[];
  improvement_plan: string[];
};

export type LeakSummaryRow = {
  id: string;
  user_id: string;
  period_start: string; // date as ISO string
  period_end: string; // date as ISO string
  summary: LeakSummary;
  created_at: string;
};

export type LeakAggregation = {
  tag: string;
  count: number;
  examples: string[];
};
