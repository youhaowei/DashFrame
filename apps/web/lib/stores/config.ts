// Centralized Immer configuration for all Zustand stores
import { enableMapSet, setAutoFreeze } from "immer";

enableMapSet();
setAutoFreeze(false);

