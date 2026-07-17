import React, { useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SelectedServiceView } from '../../types';
import { Server, CloudLightning, Activity } from 'lucide-react';

// Custom Node to match Murzak design
const ServiceNode = ({ data }: any) => {
  const isHealthy = data.status === "Active";
  const isPending = data.status === "Setting up";
  
  return (
    <div 
      className={`px-4 py-3 shadow-xl rounded-xl border ${
        isHealthy ? 'border-murzak-success/30 bg-murzak-success/5' : 
        isPending ? 'border-orange-500/30 bg-orange-500/5' : 
        'border-red-500/30 bg-red-500/5'
      } backdrop-blur-md min-w-[150px] flex flex-col items-center justify-center relative cursor-pointer hover:scale-105 transition-transform`}
      onClick={data.onClick}
    >
      <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
        isHealthy ? 'bg-murzak-success shadow-[0_0_10px_#00ff00] animate-pulse' : 
        isPending ? 'bg-orange-500 shadow-[0_0_10px_#ffa500] animate-pulse' : 
        'bg-red-500 shadow-[0_0_10px_#ff0000] animate-pulse'
      }`} />
      
      {data.icon}
      
      <div className="mt-2 text-sm font-semibold text-white whitespace-nowrap">
        {data.label}
      </div>
      <div className="text-xs text-gray-400">
        {data.sublabel}
      </div>
    </div>
  );
};

const nodeTypes = {
  serviceNode: ServiceNode,
};

interface TopologyMapProps {
  services: SelectedServiceView[];
  onNodeClick: (serviceId: string) => void;
}

const TopologyMap: React.FC<TopologyMapProps> = ({ services, onNodeClick }) => {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    // Add an internet entry point
    nodes.push({
      id: 'internet',
      type: 'serviceNode',
      position: { x: 250, y: 50 },
      data: { 
        label: 'Internet', 
        sublabel: 'Global Edge',
        status: 'Active',
        icon: <CloudLightning className="w-8 h-8 text-blue-400" />
      }
    });

    let yOffset = 200;
    
    if (services.length === 0) {
      nodes.push({
        id: 'empty',
        type: 'serviceNode',
        position: { x: 250, y: yOffset },
        data: { 
          label: 'No Services', 
          sublabel: 'Deploy to see topology',
          status: 'Inactive',
          icon: <Activity className="w-8 h-8 text-gray-500" />
        }
      });
      edges.push({
        id: 'e-internet-empty',
        source: 'internet',
        target: 'empty',
        animated: true,
        style: { stroke: '#ffffff33' }
      });
    }

    services.forEach((svc, index) => {
      const xOffsetApp = 100 + (index * 300);
      const appId = `app-${svc.serviceId}`;

      // App Node — reflects this service's real status only. No inferred
      // database/replication nodes: we don't have real per-service infra
      // topology to report, so we don't imply one.
      nodes.push({
        id: appId,
        type: 'serviceNode',
        position: { x: xOffsetApp, y: yOffset },
        data: {
          label: svc.name || svc.category,
          sublabel: svc.status,
          status: svc.status,
          icon: <Server className={`w-8 h-8 ${svc.status === 'Active' ? 'text-murzak-success' : 'text-orange-400'}`} />,
          onClick: () => onNodeClick(svc.serviceId)
        }
      });

      // Connect Internet -> App
      edges.push({
        id: `e-internet-${appId}`,
        source: 'internet',
        target: appId,
        animated: svc.status === 'Active',
        style: { stroke: svc.status === 'Active' ? '#00ff00' : '#ffa500', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: svc.status === 'Active' ? '#00ff00' : '#ffa500' }
      });
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [services, onNodeClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="w-full h-[600px] border border-white/10 rounded-2xl overflow-hidden bg-black/40 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="bg-transparent"
        colorMode="dark"
      >
        <Background gap={16} size={1} color="#ffffff10" />
        <Controls className="bg-gray-900 border-white/10 fill-white" />
      </ReactFlow>
      
      <div className="absolute top-4 left-4 pointer-events-none">
        <h3 className="text-xl font-bold tracking-tight text-white flex items-center">
          <Activity className="w-5 h-5 mr-2 text-murzak-success" />
          Live Topology
        </h3>
        <p className="text-sm text-gray-400">Interactive logical architecture mapping</p>
      </div>
    </div>
  );
};

export default TopologyMap;
