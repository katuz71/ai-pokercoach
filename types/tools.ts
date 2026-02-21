export type LeakSummaryShort = {
  top_leaks: { tag: string; count: number; explanation?: string }[];
  improvement_plan?: string[];
};
