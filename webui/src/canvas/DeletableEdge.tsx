import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "reactflow";

// Smooth-step edge with a small × button shown on hover or when selected.
// React Flow's default Backspace/Delete shortcut still works; this is just
// the discoverable affordance.
//
// When the same (source, sourceHandle) has ≥ 2 outgoing edges, every
// downstream receives the same batch — i.e. broadcast/tee semantics,
// distinct from Judge-style routing on .on_true / .on_false. We mark
// such edges in amber and tag them with a small "broadcast" chip so
// users don't mistake them for a router that doesn't exist.
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  data,
}: EdgeProps<{ isBroadcast?: boolean }>) {
  const { setEdges } = useReactFlow();
  const [hover, setHover] = useState(false);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const visible = hover || selected;
  const isBroadcast = !!data?.isBroadcast;
  const strokeColor = selected
    ? "#0284c7"
    : isBroadcast
    ? "#f59e0b"
    : style?.stroke ?? "#94a3b8";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: selected ? 2 : isBroadcast ? 2 : 1.5,
          strokeDasharray: isBroadcast ? "6 3" : undefined,
        }}
      />
      {/* Wider invisible hit-target so the × is easy to grab. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ pointerEvents: "stroke" }}
      />
      <EdgeLabelRenderer>
        {isBroadcast && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - 14}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            <span
              title="Broadcast: this source's output is copied to every downstream on this port. Use Judge to route by condition instead."
              className="px-1.5 py-px rounded bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-medium leading-none whitespace-nowrap shadow-sm"
            >
              broadcast
            </span>
          </div>
        )}
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
            opacity: visible ? 1 : 0,
            transition: "opacity 120ms",
          }}
          className="nodrag nopan"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEdges((eds) => eds.filter((edge) => edge.id !== id));
            }}
            title="Delete edge"
            className="w-5 h-5 rounded-full bg-white border border-slate-300 shadow text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300 text-xs leading-none flex items-center justify-center"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
