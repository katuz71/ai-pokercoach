export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          skill_level: string | null;
          plays_for_money: string | null;
          game_types: string[] | null;
          goals: string[] | null;
          weak_areas: string[] | null;
          coach_style: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          skill_level?: string | null;
          plays_for_money?: string | null;
          game_types?: string[] | null;
          goals?: string[] | null;
          weak_areas?: string[] | null;
          coach_style?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          skill_level?: string | null;
          plays_for_money?: string | null;
          game_types?: string[] | null;
          goals?: string[] | null;
          weak_areas?: string[] | null;
          coach_style?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      hand_analyses: {
        Row: {
          id: string;
          user_id: string;
          input: any; // jsonb
          result: any; // jsonb
          mistake_tags: string[];
          is_deleted: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          input: any;
          result: any;
          mistake_tags?: string[];
          is_deleted?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          input?: any;
          result?: any;
          mistake_tags?: string[];
          is_deleted?: boolean;
          created_at?: string;
        };
      };
      coach_memory: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          content: string;
          metadata: any; // jsonb
          embedding: string | null; // vector
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          content: string;
          metadata?: any;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          content?: string;
          metadata?: any;
          embedding?: string | null;
          created_at?: string;
        };
      };
      leak_summaries: {
        Row: {
          id: string;
          user_id: string;
          period_start: string; // date
          period_end: string; // date
          summary: any; // jsonb
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_start: string;
          period_end: string;
          summary: any;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period_start?: string;
          period_end?: string;
          summary?: any;
          created_at?: string;
        };
      };
      training_events: {
        Row: {
          id: string;
          user_id: string;
          scenario: any; // jsonb
          user_action: string;
          correct_action: string;
          mistake_tag: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scenario: any;
          user_action: string;
          correct_action: string;
          mistake_tag?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scenario?: any;
          user_action?: string;
          correct_action?: string;
          mistake_tag?: string | null;
          created_at?: string;
        };
      };
      daily_checkins: {
        Row: {
          id: string;
          user_id: string;
          checkin_date: string; // date
          message: any; // jsonb
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          checkin_date: string;
          message: any;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          checkin_date?: string;
          message?: any;
          created_at?: string;
        };
      };
      action_plans: {
        Row: {
          id: string;
          user_id: string;
          period_start: string; // date
          period_end: string; // date
          focus_tag: string | null;
          items: any; // jsonb
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_start: string;
          period_end: string;
          focus_tag?: string | null;
          items: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period_start?: string;
          period_end?: string;
          focus_tag?: string | null;
          items?: any;
          created_at?: string;
          updated_at?: string;
        };
      };
      drill_queue: {
        Row: {
          id: string;
          user_id: string;
          leak_tag: string;
          status: string;
          due_at: string;
          last_drill_id: string | null;
          last_score: number | null;
          repetition: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          leak_tag: string;
          status?: string;
          due_at?: string;
          last_drill_id?: string | null;
          last_score?: number | null;
          repetition?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          leak_tag?: string;
          status?: string;
          due_at?: string;
          last_drill_id?: string | null;
          last_score?: number | null;
          repetition?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Functions: {
      rpc_get_due_drills: {
        Args: { limit_n?: number };
        Returns: Database['public']['Tables']['drill_queue']['Row'][];
      };
    };
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type HandAnalysisRow = Database['public']['Tables']['hand_analyses']['Row'];
export type CoachMemoryRow = Database['public']['Tables']['coach_memory']['Row'];
export type LeakSummaryRow = Database['public']['Tables']['leak_summaries']['Row'];
export type TrainingEventRow = Database['public']['Tables']['training_events']['Row'];
export type DailyCheckinRow = Database['public']['Tables']['daily_checkins']['Row'];
export type ActionPlanRow = Database['public']['Tables']['action_plans']['Row'];
export type DrillQueueRow = Database['public']['Tables']['drill_queue']['Row'];
