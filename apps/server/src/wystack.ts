import { defineApp } from "@wystack/server";

import type { AppContext } from "./app-context";
import { permissions } from "./permissions";

export const wy = defineApp<AppContext>({ permissions });
