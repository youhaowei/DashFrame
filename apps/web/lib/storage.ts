import type { DataFrame } from "@dash-frame/dataframe";
import type { AxisSelection } from "./spec";

const DATAFRAME_STORAGE_KEY = "dash-frame:dataframe";
const AXIS_STORAGE_KEY = "dash-frame:axes";

const isBrowser = () => typeof window !== "undefined";

export const persistDataFrame = (dataFrame: DataFrame | null) => {
  if (!isBrowser()) return;
  if (!dataFrame) {
    window.localStorage.removeItem(DATAFRAME_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(DATAFRAME_STORAGE_KEY, JSON.stringify(dataFrame));
};

export const persistAxisSelection = (axes: AxisSelection) => {
  if (!isBrowser()) return;
  if (!axes.x && !axes.y) {
    window.localStorage.removeItem(AXIS_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AXIS_STORAGE_KEY, JSON.stringify(axes));
};

export const readPersistedDataFrame = (): DataFrame | null => {
  if (!isBrowser()) return null;
  const stored = window.localStorage.getItem(DATAFRAME_STORAGE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as DataFrame;
    if (!parsed?.columns?.length) return null;
    return parsed;
  } catch (error) {
    console.warn("Failed to parse persisted DataFrame", error);
    window.localStorage.removeItem(DATAFRAME_STORAGE_KEY);
    return null;
  }
};

export const readPersistedAxisSelection = (): AxisSelection => {
  if (!isBrowser()) return { x: null, y: null };
  const stored = window.localStorage.getItem(AXIS_STORAGE_KEY);
  if (!stored) return { x: null, y: null };

  try {
    const parsed = JSON.parse(stored) as Partial<AxisSelection>;
    return {
      x: parsed?.x ?? null,
      y: parsed?.y ?? null,
    };
  } catch (error) {
    console.warn("Failed to parse persisted axis selection", error);
    window.localStorage.removeItem(AXIS_STORAGE_KEY);
    return { x: null, y: null };
  }
};
