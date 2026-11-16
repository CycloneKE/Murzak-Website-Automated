import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { User } from '../../types';

export type CommandAction = {
  id: string;
  title: string;
  subtitle: string;
  icon: any;
  onSelect: () => void;
};

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  user?: User | null;
  actions?: CommandAction[];
}

/**
 * Search (Ctrl+K). Lists the actions the portal hands it — pages, the
 * customer's own services, and a couple of shortcuts — so a result always
 * goes somewhere real.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, actions = [] }) => {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setInputValue('');
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const run = (action: CommandAction) => {
    onClose();
    action.onSelect();
  };

  const pages = actions.filter((a) => a.id.startsWith('nav-'));
  const services = actions.filter((a) => a.id.startsWith('sys-'));
  const other = actions.filter((a) => !a.id.startsWith('nav-') && !a.id.startsWith('sys-'));
  const groups = [
    { heading: 'Go to', items: pages },
    { heading: 'Your services', items: services },
    { heading: 'Actions', items: other },
  ].filter((g) => g.items.length > 0);

  const itemClass =
    'flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-md text-sm text-p-text aria-selected:bg-p-accent-soft';

  return createPortal(
    <div className="portal fixed inset-0 z-200 flex items-start justify-center pt-[12vh] px-4 !bg-transparent">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-xl rounded-lg border border-p-border bg-p-panel shadow-2xl overflow-hidden"
      >
        <Command label="Search the portal" shouldFilter className="w-full">
          <div className="flex items-center gap-2 border-b border-p-border px-4">
            <Search className="w-4 h-4 text-p-muted shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Search pages, services and actions"
              value={inputValue}
              onValueChange={setInputValue}
              className="w-full bg-transparent text-p-text placeholder:text-p-muted h-12 outline-hidden border-none text-sm"
            />
            <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-p-border bg-p-panel-2 text-p-muted">Esc</kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-[13px] text-p-muted">Nothing matches that.</Command.Empty>

            {groups.map((g) => (
              <Command.Group
                key={g.heading}
                heading={g.heading}
                className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-p-muted"
              >
                {g.items.map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`${a.title} ${a.subtitle}`}
                    onSelect={() => run(a)}
                    className={itemClass}
                  >
                    <span className="shrink-0 text-p-muted">{a.icon}</span>
                    <span className="min-w-0 grow truncate">{a.title}</span>
                    <span className="hidden sm:block shrink-0 max-w-[45%] truncate text-[13px] text-p-muted">{a.subtitle}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>,
    document.body,
  );
};

export default CommandPalette;
