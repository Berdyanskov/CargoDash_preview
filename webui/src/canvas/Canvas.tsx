import { useCallback, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type EdgeTypes,
  type ReactFlowInstance,
} from "reactflow";
import { useGraphStore } from "../store/graphStore";
import { nodeTypes } from "../nodes";
import type { NodeKind } from "../types/graph";
import { DeletableEdge } from "./DeletableEdge";

export function Canvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const selectNode = useGraphStore((s) => s.selectNode);
  const addNode = useGraphStore((s) => s.addNode);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/cargodash-node") as
        | NodeKind
        | "";
      if (!kind || !rfRef.current) return;
      const position = rfRef.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      addNode(kind, position);
    },
    [addNode],
  );

  const edgeTypes: EdgeTypes = useMemo(
    () => ({ smoothstep: DeletableEdge, default: DeletableEdge }),
    [],
  );

  return (
    <div ref={wrapperRef} className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(rf) => (rfRef.current = rf)}
        onSelectionChange={({ nodes }) =>
          selectNode(nodes[0]?.id ?? null)
        }
        deleteKeyCode={["Delete", "Backspace"]}
        fitView
      >
        <Background gap={16} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
