import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2 } from 'lucide-react';
import { aiService, ChatMessage } from '../services/aiService';
import { toUserMessage } from '../services/errors';

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
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: toUserMessage(e, "I couldn't get a response just now. Please try again in a moment."),
      }]);
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
          className="fixed bottom-6 right-6 p-4 rounded-full bg-p-accent text-p-accent-fg shadow-lg transition-transform z-50 flex items-center justify-center"
        >
          <MessageSquare size={24} />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-80 sm:w-96 h-[500px] max-h-[80vh] bg-p-panel border border-p-accent/40 rounded-lg shadow-2xl flex flex-col z-50 overflow-hidden">
          {/* Header */}
          <div className="bg-p-panel-2 border-b border-p-border p-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-p-accent-soft text-p-accent-text flex items-center justify-center border border-p-accent/40">
                <Bot size={18} />
              </div>
              <div>
                <h3 className="text-p-text font-medium text-sm">Murzaker</h3>
                <p className="text-p-accent-text text-xs ">AI Concierge</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-p-muted hover:text-p-text transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 ">
            {isInitializing ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="animate-spin text-p-accent-text" size={24} />
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-p-accent text-p-accent-fg rounded-tr-sm'
                      : 'bg-p-panel-2 text-p-text border border-p-border rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-p-panel-2 text-p-text border border-p-border rounded-lg rounded-tl-sm px-4 py-3 text-sm flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-p-panel-2 border-t border-p-border">
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Murzaker..."
                className="w-full bg-p-panel-2 border border-p-border rounded-md pl-4 pr-12 py-3 text-sm text-p-text placeholder-slate-500 focus:outline-hidden focus:border-p-accent resize-none max-h-32"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-p-accent-text hover:bg-p-accent-soft rounded-lg disabled:opacity-50 transition-colors"
              >
                <Send size={18} />
              </button>
            </div>
            <div className="mt-2 text-center">
              <span className="text-xs text-p-muted ">Murzaker AI can make mistakes. Verify important info.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ConciergeWidget;
