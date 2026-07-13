export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
}

export const aiService = {
  getHistory: async (): Promise<ChatMessage[]> => {
    try {
      const res = await fetch('/api/ai/history', {
        headers: {
          'Accept': 'application/json'
        },
        credentials: 'include'
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return [];
        throw new Error('Failed to fetch chat history');
      }
      const data = await res.json();
      return data.history || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  sendMessage: async (message: string): Promise<string> => {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ message })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message');
      }
      
      return data.message;
    } catch (e: any) {
      console.error(e);
      throw new Error(e.message || "Murzaker is currently unavailable.");
    }
  }
};
