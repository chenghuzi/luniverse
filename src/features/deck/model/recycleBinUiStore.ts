import { create } from "zustand";

export type DockRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DragCenter = {
  x: number;
  y: number;
};

export type DragSide = "left" | "right" | null;

type RecycleBinUiActions = {
  setDockRect: (rect: DockRect | null) => void;
  setDragActive: (active: boolean) => void;
  setDragCenter: (center: DragCenter | null) => void;
  setDragSide: (side: DragSide) => void;
};

type RecycleBinUiState = {
  dockRect: DockRect | null;
  dragActive: boolean;
  dragCenter: DragCenter | null;
  dragSide: DragSide;
  actions: RecycleBinUiActions;
};

export const useRecycleBinUiStore = create<RecycleBinUiState>((set) => ({
  dockRect: null,
  dragActive: false,
  dragCenter: null,
  dragSide: null,
  actions: {
    setDockRect: (rect) => set({ dockRect: rect }),
    setDragActive: (active) => set({ dragActive: Boolean(active) }),
    setDragCenter: (center) => set({ dragCenter: center }),
    setDragSide: (side) => set({ dragSide: side }),
  },
}));
