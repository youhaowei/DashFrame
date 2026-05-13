import { createFileRoute } from "@tanstack/react-router";
import HomePage from "../../app/page";

export const Route = createFileRoute("/")({
  component: HomePage,
});
