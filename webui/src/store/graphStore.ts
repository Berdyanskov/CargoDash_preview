import { create } from "zustand";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  addEdge,
} from "reactflow";
import type {
  AnyNodeData,
  EdgePort,
  GraphProject,
  NodeKind,
} from "../types/graph";
import { defaultNodeData } from "../nodes/defaults";

export type FlowNode = Node<AnyNodeData>;
export type FlowEdge = Edge;

interface GraphState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedId: string | null;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;

  addNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<AnyNodeData>) => void;
  deleteNode: (id: string) => void;
  selectNode: (id: string | null) => void;

  loadProject: (project: GraphProject) => void;
  toProject: () => GraphProject;
  reset: () => void;
}

let nodeCounter = 0;
const nextNodeId = (kind: NodeKind) => `${kind}_${++nodeCounter}`;

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

  onEdgesChange: (changes) =>
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

  onConnect: (conn) =>
    set((s) => {
      // sourceHandle drives Judge.on_true / on_false. Default is "default".
      const port: EdgePort =
        conn.sourceHandle === "true" || conn.sourceHandle === "false"
          ? conn.sourceHandle
          : "default";
      return {
        edges: addEdge(
          { ...conn, sourceHandle: port, type: "smoothstep" },
          s.edges,
        ),
      };
    }),

  addNode: (kind, position) =>
    set((s) => {
      const id = nextNodeId(kind);
      const data = defaultNodeData(kind, id);
      const node: FlowNode = { id, type: kind, position, data };
      return { nodes: [...s.nodes, node], selectedId: id };
    }),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, ...patch } as AnyNodeData }
          : n,
      ),
    })),

  deleteNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectNode: (id) => set({ selectedId: id }),

  loadProject: (project) => {
    if (project.version !== 1) {
      throw new Error(`unsupported project version: ${project.version}`);
    }
    nodeCounter = Math.max(
      nodeCounter,
      ...project.nodes.map((n) => parseInt(n.id.split("_").pop() ?? "0", 10)),
    );
    set({
      nodes: project.nodes.map((n) => ({
        id: n.id,
        position: n.position,
        type: n.data.kind,
        data: n.data,
      })),
      edges: project.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        type: "smoothstep",
      })),
      selectedId: null,
    });
  },

  toProject: () => {
    const { nodes, edges } = get();
    return {
      version: 1,
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (e.sourceHandle as EdgePort) ?? "default",
      })),
    };
  },

  reset: () => set({ nodes: [], edges: [], selectedId: null }),
}));
