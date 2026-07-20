import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2 } from 'lucide-react';
import { aiService, ChatMessage } from '../services/aiService';

const ConciergeWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  useEffect(() => {
    // Load history when component mounts (or when opened for the first time)
    const loadHistory = async () => {
      setIsInitializing(true);
      try {
        const history = await aiService.getHistory();
        if (history.length > 0) {
          setMessages(history);
        } else {
          // Welcome message
          setMessages([{
            role: 'assistant',
            content: 'Hello! I am Murzaker, your technical concierge. How can I help you run your business today?'
          }]);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsInitializing(false);
      }
    };
    
    loadHistory();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const responseMsg = await aiService.sendMessage(userMsg);
      setMessages(prev => [...prev, { role: 'assistant', content: responseMsg }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 p-4 rounded-full bg-murzak-accent text-murzak-ink shadow-[0_0_20px_rgba(0,189,252,0.4)] hover:scale-105 transition-transform z-50 flex items-center justify-center"
        >
          <MessageSquare size={24} />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-80 sm:w-96 h-[500px] max-h-[80vh] glass-dark border border-murzak-accent/30 rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden">
          {/* Header */}
          <div className="bg-black/5 border-b border-murzak-border p-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-murzak-accent/20 text-murzak-accent flex items-center justify-center border border-murzak-accent/30">
                <Bot size={18} />
              </div>
              <div>
                <h3 className="text-murzak-ink font-bold text-sm">Murzaker</h3>
                <p className="text-murzak-accent text-micro uppercase">AI Concierge</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-murzak-ink transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-murzak-surface/30">
            {isInitializing ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="animate-spin text-murzak-accent" size={24} />
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-murzak-accent text-murzak-ink rounded-tr-sm'
                      : 'bg-black/5 text-murzak-ink border border-murzak-border/50 rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-black/5 text-murzak-ink border border-murzak-border/50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-black/5 border-t border-murzak-border">
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Murzaker..."
                className="w-full bg-black/5 border border-murzak-border rounded-xl pl-4 pr-12 py-3 text-sm text-murzak-ink placeholder-slate-500 focus:outline-none focus:border-murzak-accent/50 resize-none max-h-32"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-murzak-accent hover:bg-murzak-accent/10 rounded-lg disabled:opacity-50 transition-colors"
              >
                <Send size={18} />
              </button>
            </div>
            <div className="mt-2 text-center">
              <span className="text-micro text-slate-600 dark:text-slate-400 uppercase">Murzaker AI can make mistakes. Verify important info.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ConciergeWidget;
