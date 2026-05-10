import type { ReactNode } from "react";
import { useGraphStore } from "../store/graphStore";

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  accent: string;
  children?: ReactNode;
  selected?: boolean;
}

export function NodeShell({
  id,
  title,
  subtitle,
  accent,
  children,
  selected,
}: Props) {
  const selectedId = useGraphStore((s) => s.selectedId);
  const isSelected = selected ?? selectedId === id;
  return (
    <div
      className={`min-w-[180px] rounded-md border bg-white shadow-sm text-xs ${
        isSelected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-300"
      }`}
    >
      <div
        className={`px-3 py-2 rounded-t-md text-white font-medium ${accent}`}
      >
        <div>{title}</div>
        {subtitle && <div className="text-[10px] opacity-90">{subtitle}</div>}
      </div>
      {children && <div className="px-3 py-2 text-slate-600">{children}</div>}
    </div>
  );
}
