import React, { useState } from "react";
import { Button } from "../ui/Button";

interface ScalingSettingsProps {
  serviceId: string;
  onClose: () => void;
}

export function ScalingSettings({ serviceId, onClose }: ScalingSettingsProps) {
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [replicas, setReplicas] = useState(1);
  const [minReplicas, setMinReplicas] = useState(1);
  const [maxReplicas, setMaxReplicas] = useState(3);
  const [cpuPercent, setCpuPercent] = useState(80);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setError("");
    setSuccess(false);
    try {
      const body = mode === "manual" 
        ? { lane: "k8s", mode: "manual", replicas }
        : { lane: "k8s", mode: "auto", minReplicas, maxReplicas, targetCpuUtilizationPercentage: cpuPercent };

      const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/scale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save scaling settings.");
      setSuccess(true);
      setTimeout(onClose, 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#1e1e1e] p-6 rounded-lg border border-[#333] max-w-md w-full mx-auto relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
      <h3 className="text-xl font-medium text-white mb-4">Scaling Settings</h3>

      {error && <div className="mb-4 p-3 bg-red-900/50 border border-red-500/50 rounded text-red-200 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-900/50 border border-green-500/50 rounded text-green-200 text-sm">Scaling settings updated successfully.</div>}

      <div className="mb-6 flex gap-2 p-1 bg-[#2a2a2a] rounded-lg">
        <button
          onClick={() => setMode("manual")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === "manual" ? "bg-[#3a3a3a] text-white" : "text-gray-400 hover:text-white"}`}
        >
          Manual
        </button>
        <button
          onClick={() => setMode("auto")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === "auto" ? "bg-[#3a3a3a] text-white" : "text-gray-400 hover:text-white"}`}
        >
          Auto-scaling (HPA)
        </button>
      </div>

      <div className="space-y-4">
        {mode === "manual" ? (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Replicas</label>
            <input 
              type="number" 
              min={1} 
              max={10} 
              value={replicas} 
              onChange={e => setReplicas(parseInt(e.target.value) || 1)} 
              className="w-full bg-[#2a2a2a] border border-[#333] text-white rounded p-2 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Fixed number of pods running your application.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Min Replicas</label>
                <input 
                  type="number" 
                  min={1} 
                  max={maxReplicas} 
                  value={minReplicas} 
                  onChange={e => setMinReplicas(parseInt(e.target.value) || 1)} 
                  className="w-full bg-[#2a2a2a] border border-[#333] text-white rounded p-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Max Replicas</label>
                <input 
                  type="number" 
                  min={minReplicas} 
                  max={20} 
                  value={maxReplicas} 
                  onChange={e => setMaxReplicas(parseInt(e.target.value) || 1)} 
                  className="w-full bg-[#2a2a2a] border border-[#333] text-white rounded p-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Target CPU (%)</label>
              <input 
                type="number" 
                min={10} 
                max={95} 
                value={cpuPercent} 
                onChange={e => setCpuPercent(parseInt(e.target.value) || 80)} 
                className="w-full bg-[#2a2a2a] border border-[#333] text-white rounded p-2 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">Scale out when average CPU utilization hits this target.</p>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={loading} className="border-[#444] text-gray-300 hover:text-white">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-blue-500 text-white">
          {loading ? "Saving..." : "Apply Scaling"}
        </Button>
      </div>
    </div>
  );
}
