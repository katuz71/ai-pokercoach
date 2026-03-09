export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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
          input: Json; // jsonb
          result: Json; // jsonb
          mistake_tags: string[];
          is_deleted: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          input: Json;
          result: Json;
          mistake_tags?: string[];
          is_deleted?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          input?: Json;
          result?: Json;
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
          metadata: Json; // jsonb
          embedding: string | null; // vector
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          content: string;
          metadata?: Json;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          content?: string;
          metadata?: Json;
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
          summary: Json; // jsonb
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_start: string;
          period_end: string;
          summary: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period_start?: string;
          period_end?: string;
          summary?: Json;
          created_at?: string;
        };
      };
      training_events: {
        Row: {
          id: string;
          user_id: string;
          scenario: Json; // jsonb
          user_action: string;
          correct_action: string;
          mistake_tag: string | null;
          mistake_reason: string | null;
          created_at: string;
          is_correct: boolean;
          leak_tag: string | null;
          drill_type: string | null;
          user_answer: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          scenario: Json;
          user_action: string;
          correct_action: string;
          mistake_tag?: string | null;
          mistake_reason?: string | null;
          created_at?: string;
          is_correct?: boolean;
          leak_tag?: string | null;
          drill_type?: string | null;
          user_answer?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          scenario?: Json;
          user_action?: string;
          correct_action?: string;
          mistake_tag?: string | null;
          mistake_reason?: string | null;
          created_at?: string;
          is_correct?: boolean;
          leak_tag?: string | null;
          drill_type?: string | null;
          user_answer?: string | null;
        };
      };
      daily_checkins: {
        Row: {
          id: string;
          user_id: string;
          checkin_date: string; // date
          message: Json; // jsonb
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          checkin_date: string;
          message: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          checkin_date?: string;
          message?: Json;
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
          items: Json; // jsonb
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_start: string;
          period_end: string;
          focus_tag?: string | null;
          items: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period_start?: string;
          period_end?: string;
          focus_tag?: string | null;
          items?: Json;
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
          drill_type: string;
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
          drill_type?: string;
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
          drill_type?: string;
        };
      };
      chat_threads: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          coach_style: string | null;
          created_at: string;
          updated_at: string;
          leak_tag: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          coach_style?: string | null;
          created_at?: string;
          updated_at?: string;
          leak_tag?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string | null;
          coach_style?: string | null;
          created_at?: string;
          updated_at?: string;
          leak_tag?: string | null;
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
export type ChatThreadRow = Database['public']['Tables']['chat_threads']['Row'];
