import { createContext, useContext } from "react";
import type { StudioActions, StudioData, StudioUser } from "../types";
export const Context = createContext<{ data: StudioData; currentUser: StudioUser; actions: StudioActions } | null>(null);
export function useStudio() {
  const value = useContext(Context);
  if (!value) throw new Error("StudioProvider is required");
  return value;
}
