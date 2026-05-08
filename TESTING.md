# Testing

This monorepo uses **Vitest** for all test suites — lightweight, ESM-native,
no transpile step.

## Run everything

```sh
npm test
```

This invokes `vitest run` in every workspace that has a `test` script.

## Run one package

```sh
npm test --workspace=@ratesassist/contract
npm test --workspace=@ratesassist/recovery-engine
npm test --workspace=@ratesassist/identity
npm test --workspace=@ratesassist/spatial
npm test --workspace=@ratesassist/adapter-demo
```

## Layout

Each package owns its own `tests/` directory next to `src/`. One file per
module under test:

```
packages/contract/tests/schemas.test.ts
packages/recovery-engine/tests/scoring.test.ts
packages/recovery-engine/tests/findMismatches.test.ts
packages/identity/tests/abn.test.ts
packages/spatial/tests/slip.test.ts
packages/adapter-demo/tests/dispatcher.test.ts
packages/adapter-demo/tests/commitTokens.test.ts
```

## Conventions

- **Mock fetch**, never make a real network call. Use `vi.fn()` returning
  `Response` objects.
- **Inject clocks** when behaviour is time-dependent (commit-token TTL).
  `vi.useFakeTimers()` is fine for retry-backoff sleeps.
- **The legacy is the oracle.** If the code computes 19.27 and the spec says
  19.28, the test asserts 19.27 and we file a separate bug.
- **One assertion theme per `it` block.** Names should read as
  specifications.

## Adding a new test case

1. Find the relevant `*.test.ts` file (one per module).
2. Add an `it("describes the behaviour", () => { ... })` block.
3. If you're testing a new module, create
   `packages/<pkg>/tests/<module>.test.ts`. Vitest discovers it
   automatically.

## Pending behaviours

Use `it.todo("RULE-NNN: description")` to record a behaviour that exists in
intent but not yet in code, rather than deleting the case.
