import React, { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { Search, Server, CreditCard, LayoutDashboard, Settings, User as UserIcon, LifeBuoy } from 'lucide-react';
import { User, SelectedServiceView } from '../../types';

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

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, user }) => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');

  // Toggle on Cmd+K or Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Usually toggle open logic is handled by parent, but we can call onClose if open
          // Since the parent handles the keydown as well, we might not even need this here.
          // I will just leave it.
        }
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, onClose]);

  const runCommand = (command: () => void) => {
    onClose();
    command();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl bg-[#0f1115] border border-white/10 rounded-xl shadow-2xl overflow-hidden transform transition-all">
        <Command label="Global Command Menu" shouldFilter={true} className="w-full">
          <div className="flex items-center border-b border-white/10 px-4">
            <Search className="w-5 h-5 text-gray-400 mr-2 shrink-0" />
            <Command.Input 
              autoFocus 
              placeholder="Type a command or search..." 
              value={inputValue}
              onValueChange={setInputValue}
              className="w-full bg-transparent text-white placeholder:text-gray-500 h-14 outline-none border-none text-lg"
            />
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-gray-400">
              No results found.
            </Command.Empty>

            {user?.selectedServices && user.selectedServices.length > 0 && (
              <Command.Group heading="Your Services" className="text-xs font-semibold text-gray-400 px-2 py-1 mb-1 uppercase tracking-wider">
                {user.selectedServices.map((service: SelectedServiceView) => (
                  <Command.Item
                    key={service.serviceId}
                    onSelect={() => runCommand(() => navigate('/portal'))} // Can be wired to open specific service details
                    className="flex items-center px-4 py-3 cursor-pointer text-gray-200 rounded-lg hover:bg-white/5 aria-selected:bg-murzak-green/10 aria-selected:text-murzak-green transition-colors"
                  >
                    <Server className="w-4 h-4 mr-3" />
                    <span>Manage {service.name || service.category}</span>
                    <span className="ml-auto text-xs opacity-50 bg-white/5 px-2 py-1 rounded">{service.status}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Navigation" className="text-xs font-semibold text-gray-400 px-2 py-1 mt-2 mb-1 uppercase tracking-wider">
              <Command.Item
                onSelect={() => runCommand(() => navigate('/portal'))}
                className="flex items-center px-4 py-3 cursor-pointer text-gray-200 rounded-lg hover:bg-white/5 aria-selected:bg-murzak-green/10 aria-selected:text-murzak-green transition-colors"
              >
                <LayoutDashboard className="w-4 h-4 mr-3" />
                <span>Dashboard Overview</span>
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => navigate('/portal?tab=billing'))}
                className="flex items-center px-4 py-3 cursor-pointer text-gray-200 rounded-lg hover:bg-white/5 aria-selected:bg-murzak-green/10 aria-selected:text-murzak-green transition-colors"
              >
                <CreditCard className="w-4 h-4 mr-3" />
                <span>Billing & Invoices</span>
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => navigate('/portal?tab=profile'))}
                className="flex items-center px-4 py-3 cursor-pointer text-gray-200 rounded-lg hover:bg-white/5 aria-selected:bg-murzak-green/10 aria-selected:text-murzak-green transition-colors"
              >
                <UserIcon className="w-4 h-4 mr-3" />
                <span>Profile Settings</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Support & Actions" className="text-xs font-semibold text-gray-400 px-2 py-1 mt-2 mb-1 uppercase tracking-wider">
              <Command.Item
                onSelect={() => runCommand(() => navigate('/contact'))}
                className="flex items-center px-4 py-3 cursor-pointer text-gray-200 rounded-lg hover:bg-white/5 aria-selected:bg-murzak-green/10 aria-selected:text-murzak-green transition-colors"
              >
                <LifeBuoy className="w-4 h-4 mr-3" />
                <span>Contact Support</span>
              </Command.Item>
            </Command.Group>

          </Command.List>
        </Command>
      </div>
    </div>
  );
};

export default CommandPalette;
