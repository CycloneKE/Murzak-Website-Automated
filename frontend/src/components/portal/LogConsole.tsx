import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Terminal, X, Minimize2, Maximize2, RefreshCw } from 'lucide-react';
import { SelectedServiceView } from '../../types';
import { fetchServiceActivity, ProvisioningActivityEntry } from '../../services/serviceActivity';

interface LogConsoleProps {
  serviceId: string | null;
  onClose: () => void;
  services: SelectedServiceView[];
}

function formatTimestamp(iso: string) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().split('T')[1].split('.')[0];
}

// Renders one job's recorded activity as plain lines — every value here comes
// straight from the Provisioning Job doctype (real backend/lane state), never
// generated client-side.
function linesForJob(job: ProvisioningActivityEntry): string[] {
  const ts = formatTimestamp(job.updatedAt || job.createdAt);
  const lines = [`[${ts}] [STATUS] ${job.status || 'unknown'}${job.attempts ? ` (attempt ${job.attempts})` : ''}`];
  if (job.log) {
    job.log.split('\n').filter(Boolean).forEach((l) => lines.push(`[${ts}] ${l}`));
  }
  if (job.backupStatus) lines.push(`[${ts}] [BACKUP] ${job.backupStatus}`);
  if (job.edgeStatus) lines.push(`[${ts}] [EDGE] ${job.edgeStatus}`);
  if (job.error) lines.push(`[${ts}] [ERROR] ${job.error}`);
  return lines;
}

const LogConsole: React.FC<LogConsoleProps> = ({ serviceId, onClose, services }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const endOfLogsRef = useRef<HTMLDivElement>(null);

  const activeService = services.find(s => s.serviceId === serviceId);

  const load = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const jobs = await fetchServiceActivity(serviceId);
      if (jobs.length === 0) {
        setLogs(['No provisioning activity has been recorded for this service yet.']);
      } else {
        setLogs(jobs.flatMap(linesForJob));
      }
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to load activity.');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId) return;
    load();
  }, [serviceId, load]);

  useEffect(() => {
    endOfLogsRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, isMinimized]);

  if (!serviceId) return null;

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 transition-transform duration-300 ${isMinimized ? 'translate-y-[calc(100%-48px)]' : 'translate-y-0'}`}>
      <div className="w-full max-w-5xl bg-[#0a0a0a] border border-white/20 rounded-t-xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] overflow-hidden font-mono flex flex-col" style={{ height: isMinimized ? '400px' : '400px' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-white/10 cursor-pointer select-none" onClick={() => setIsMinimized(!isMinimized)}>
          <div className="flex items-center text-gray-300 text-sm">
            <Terminal className="w-4 h-4 mr-2" />
            <span>provisioning activity: {activeService?.name || activeService?.category}</span>
            <span className="ml-3 px-2 py-0.5 rounded text-[10px] uppercase bg-white/10 text-gray-300">Recorded</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-500">
            <button className="hover:text-white transition-colors p-1" onClick={(e) => { e.stopPropagation(); load(); }} title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button className="hover:text-white transition-colors p-1" onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}>
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button className="hover:text-red-400 transition-colors p-1" onClick={(e) => { e.stopPropagation(); onClose(); }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Log Body */}
        <div className="flex-1 overflow-y-auto p-4 text-xs text-gray-300 leading-relaxed custom-scrollbar">
          {loadError && <div className="text-red-400">{loadError}</div>}
          {logs.map((log, idx) => (
            <div key={idx} className={`${log.includes('WARN') || log.includes('ERROR') ? 'text-orange-400' : ''}`}>
              {log}
            </div>
          ))}
          <div ref={endOfLogsRef} />
        </div>
      </div>
    </div>
  );
};

export default LogConsole;
