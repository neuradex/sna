import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Shell } from "./components/shell";
import { OverviewPage } from "./pages/overview";
import { AuthorizationPage } from "./pages/authorization";
import { ModelsPage } from "./pages/models";
import { RuntimePage } from "./pages/runtime";
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

const runtimeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runtime",
  component: RuntimePage,
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/models",
  component: ModelsPage,
});

const routeTree = rootRoute.addChildren([overviewRoute, authorizationRoute, sessionsRoute, runtimeRoute, modelsRoute]);

export const router = createRouter({
  routeTree,
  basepath: "/admin",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
