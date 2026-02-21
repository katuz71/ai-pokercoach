/**
 * Chat message type for Coach Chat feature
 */
export type ChatMessage = {
  id: string;
  role: 'user' | 'coach';
  text: string;
  createdAt: Date;
};

/**
 * Chat mode for ai-request edge function
 */
export type ChatMode = 'coach_chat';
