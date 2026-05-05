export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ZulipHistoryMessage {
  id: number;
  sender_id: number;
  sender_email: string;
  sender_full_name: string;
  content: string;
  timestamp: number;
}
