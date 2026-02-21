// Daily check-in types

export type DailyCheckin = {
  date: string;
  streak: number;
  focus: {
    tag: string | null;
    title: string;
    tip: string;
  };
  micro_drill: {
    question: string;
    answer: string;
  };
};

export type DailyCheckinRow = {
  id: string;
  user_id: string;
  checkin_date: string; // date as YYYY-MM-DD
  message: DailyCheckin;
  created_at: string;
};
