import React, { useState } from "react";
import { Button } from "../ui/Button";
import { toUserMessage } from "../../services/errors";

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
      setError(toUserMessage(e, "Failed to save scaling settings."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-p-panel p-6 rounded-lg border border-[#333] max-w-md w-full mx-auto relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-blue-500 to-purple-500" />
      <h3 className="text-xl font-medium text-p-text mb-4">Scaling Settings</h3>

      {error && <div className="mb-4 p-3 bg-red-900/50 border border-p-danger/40 rounded-sm text-red-200 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-900/50 border border-p-success/40 rounded-sm text-green-200 text-sm">Scaling settings updated successfully.</div>}

      <div className="mb-6 flex gap-2 p-1 bg-p-panel-2 rounded-lg">
        <button
          onClick={() => setMode("manual")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === "manual" ? "bg-p-border text-p-text" : "text-gray-400 hover:text-p-text"}`}
        >
          Manual
        </button>
        <button
          onClick={() => setMode("auto")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === "auto" ? "bg-p-border text-p-text" : "text-gray-400 hover:text-p-text"}`}
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
              className="w-full bg-p-panel-2 border border-[#333] text-p-text rounded-sm p-2 focus:border-p-info/40 focus:outline-hidden"
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
                  className="w-full bg-p-panel-2 border border-[#333] text-p-text rounded-sm p-2 focus:border-p-info/40 focus:outline-hidden"
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
                  className="w-full bg-p-panel-2 border border-[#333] text-p-text rounded-sm p-2 focus:border-p-info/40 focus:outline-hidden"
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
                className="w-full bg-p-panel-2 border border-[#333] text-p-text rounded-sm p-2 focus:border-p-info/40 focus:outline-hidden"
              />
              <p className="text-xs text-gray-500 mt-1">Scale out when average CPU utilization hits this target.</p>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={loading} className="border-[#444] text-gray-300 hover:text-p-text">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-p-info text-p-text">
          {loading ? "Saving..." : "Apply Scaling"}
        </Button>
      </div>
    </div>
  );
}
