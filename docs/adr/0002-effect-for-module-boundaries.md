# Deep modules with Effect services and Layers; one public interface per module

Notty is organised as a small number of deep modules. Each module lives in its own folder and exposes exactly one public interface at `index.ts`. Implementation files inside the folder are private. Modules communicate through Effect services (`Context.Tag`) resolved from Layers, so production and test adapters are swapped by wiring rather than by conditional code.

We chose Effect over plain TypeScript interfaces because TypeScript cannot enforce a module boundary on its own. Effect gives us dependency injection at the seam, typed error channels, and resource management for file and database handles — and the Layer system is what makes a second adapter (in-memory for tests) cheap enough to actually exist. A seam with only a production adapter is indirection; Effect makes the test adapter the default.

**Consequences:** Contributing requires some Effect fluency. We accept that cost to keep module interfaces small and testable. Boundary violations are additionally caught by a dependency-cruiser rule that forbids importing past a module's `index.ts`.

**Rejected:** plain modules with manual constructor injection (no enforcement, adapters drift); a package-per-module monorepo (too much tooling for a single-app repo).
