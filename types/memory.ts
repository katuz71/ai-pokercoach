// Coach memory types for RAG

export type CoachMemoryType = 'hand_case' | 'leak_summary' | 'note';

export type CoachMemoryMetadata = {
  analysis_id?: string;
  mistake_tag?: string;
  [key: string]: any;
};

export type CoachMemoryRow = {
  id: string;
  user_id: string;
  type: CoachMemoryType;
  content: string;
  metadata: CoachMemoryMetadata;
  embedding?: number[] | null;
  created_at: string;
};

export type CoachMemoryInsert = {
  id?: string;
  user_id: string;
  type: CoachMemoryType;
  content: string;
  metadata?: CoachMemoryMetadata;
  embedding?: string; // Supabase expects vector as string
  created_at?: string;
};

export type RetrievedMemory = {
  id: string;
  content: string;
  metadata: CoachMemoryMetadata;
  similarity?: number;
};
