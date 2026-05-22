import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Shell } from "./components/shell";
import { OverviewPage } from "./pages/overview";
import { AuthorizationPage } from "./pages/authorization";
import { SessionsPage } from "./pages/sessions";

const rootRoute = createRootRoute({
  component: Shell,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});

const authorizationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/authorization",
  component: AuthorizationPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const routeTree = rootRoute.addChildren([overviewRoute, authorizationRoute, sessionsRoute]);

export const router = createRouter({
  routeTree,
  basepath: "/admin",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
