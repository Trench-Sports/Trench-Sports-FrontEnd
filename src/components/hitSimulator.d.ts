// Type shim for the legacy .jsx component (not yet migrated to TS).
// Keeps it importable from TS without pulling its untyped internals into the
// typecheck. Migrate the .jsx to .tsx to get real types (see plan §0 / decision 6).
import type { ComponentType } from "react";
declare const Component: ComponentType<any>;
export default Component;
