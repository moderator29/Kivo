// Stand-in for the `server-only` marker package when a driver script runs the
// application's server modules directly under tsx. The real package throws
// unless resolved under Next's react-server condition, and that condition
// takes React's server build with it — which the icon registry these modules
// transitively import cannot load. The marker has no runtime behaviour to
// preserve; it exists to fail a *bundler*, and there is no bundler here.
export {};
