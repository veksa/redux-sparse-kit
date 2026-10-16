# redux-sparse-kit

[![npm version](https://img.shields.io/npm/v/redux-sparse-kit.svg?style=flat-square)](https://www.npmjs.com/package/redux-sparse-kit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE.md)

Dynamic reducers and epics for large Redux stores: only mounted features run on dispatch.

Every action a Redux store dispatches goes through every reducer, and with
redux-observable every epic sees it too. In a large application most of that
work is spent on features that are not on screen. `redux-sparse-kit` keeps the
store _sparse_: a feature's reducer and epics are injected when the feature
mounts and evicted some time after it is gone, so the cost of a dispatch
follows what the user is looking at, not the size of the codebase.

- **Segments** - a reducer, its epics and the segments it depends on, injected
  and evicted as one unit. Each part is optional.
- **Reference counting** - a segment stays while anything holds it; shared
  segments and dependencies are never evicted from under a feature.
- **Idle eviction** - a released segment waits before it is evicted, so moving
  back and forth between pages does not tear features down and set them up
  again. Idle segments can keep running, pause their epics or freeze.
- **Ordered, atomic changes** - dependencies are injected before their
  dependents and evicted after them; every batch of changes reaches the store
  as a single action.
- **Typed scopes** - an epic that reads a segment its segment does not depend
  on is a type error.
- **Scope checks** - in development, reads of a segment's state outside the
  part of the tree that holds it are reported.
- **Works with what you have** - a plain store enhancer, usable with
  `createStore` or Redux Toolkit's `configureStore`, with any root reducer.

## Installation

```bash
npm install redux-sparse-kit
# or
yarn add redux-sparse-kit
```

`redux` 5 is required. React bindings need `react` 18 or later and
`react-redux`; epics need `rxjs` 7 and an epic middleware such as
`redux-observable`. Types need TypeScript 5.4 or later.

## Quick start

### 1. Create the store

```ts
import {
  applyMiddleware,
  combineReducers,
  compose,
  legacy_createStore as createStore,
} from 'redux';
import type { StoreEnhancer } from 'redux';
import { createEpicMiddleware } from 'redux-observable';
import type { SparseStoreExt } from 'redux-sparse-kit';
import { sparseEnhancer } from 'redux-sparse-kit';
import { createEpicRunner } from 'redux-sparse-kit/observable';

const epicMiddleware = createEpicMiddleware();

export const store = createStore(
  // The static state: always present, owned by the root reducer as usual.
  combineReducers({ session: sessionReducer, router: routerReducer }),
  // `compose` does not keep the types enhancers add to the store.
  compose(
    applyMiddleware(epicMiddleware),
    sparseEnhancer({ epicRunner: createEpicRunner(epicMiddleware) }),
  ) as StoreEnhancer<SparseStoreExt>,
);

epicMiddleware.run(rootEpic);
```

With Redux Toolkit, which keeps the type of `store.sparse` on its own:

```ts
const store = configureStore({
  reducer: { session: sessionReducer, router: routerReducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(epicMiddleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(sparseEnhancer({ epicRunner: createEpicRunner(epicMiddleware) })),
});
```

### 2. Define segments

```ts
import { defineSegment } from 'redux-sparse-kit';

export const accountSegment = defineSegment({
  key: 'account',
  reducer: accountReducer,
});

export const ordersSegment = defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  deps: [accountSegment],
  epics: [loadOrdersEpic],
});
```

A segment owns the top-level state key it names. Its dependencies are present
for as long as it is.

### 3. Hold them where they are used

```tsx
import { SparseScope } from 'redux-sparse-kit/react';

export function OrdersPage() {
  return (
    <SparseScope segments={[ordersSegment]} fallback={<Spinner />}>
      <OrdersTable />
    </SparseScope>
  );
}
```

`OrdersTable` renders once `orders` and `account` are in the store, and reads
them with `useSelector` as usual. When `OrdersPage` unmounts, the segments go
idle and are evicted a minute later unless something holds them again.

## Segments

```ts
defineSegment({
  key: 'orders', // the top-level state key the reducer owns
  reducer: ordersReducer,
  deps: [accountSegment], // present for as long as this segment is
  epics: [loadOrdersEpic], // started after injection, stopped before eviction
  idleTimeout: 5 * 60_000, // overrides the store's idle timeout
  whileIdle: 'pause-epics', // overrides the store's idle behaviour
});
```

Every part but the key is optional. A segment without a reducer owns no slice
of the state: it can run epics only, or only bundle the segments it depends on,
so that one scope holds a whole page.

```ts
const pricePolling = defineSegment({ key: 'pricePolling', epics: [pollPricesEpic] });

const ordersPage = defineSegment({
  key: 'ordersPage',
  deps: [ordersSegment, pricesSegment, pricePolling],
});
```

A dependency has to be defined before the segments that list it, so the
dependency graph cannot have cycles. Two different segments cannot use the same
key in one store at the same time.

### Typing epics

The state a segment's epics may read is the static state, the segment's own
slice and the slices of its direct dependencies. An epic that declares a state
outside of that is rejected:

```ts
import type { Epic } from 'redux-observable';
import type { StateOfSegments } from 'redux-sparse-kit';

type OrdersState = StateOfSegments<typeof accountSegment> & { orders: Orders };

const loadOrdersEpic: Epic<Action, Action, OrdersState> = (action$, state$) => /* ... */;

defineSegment({ key: 'orders', reducer: ordersReducer, deps: [accountSegment], epics: [loadOrdersEpic] }); // ok
defineSegment({ key: 'orders', reducer: ordersReducer, epics: [loadOrdersEpic] }); // error: reads `account`
```

Epics typed with a `void`, `unknown` or `any` state do not read it and are
always accepted. Register the static state once to let epics read it too:

```ts
declare module 'redux-sparse-kit' {
  interface StaticState {
    session: SessionState;
    router: RouterState;
  }
}
```

`ScopeStateOf<typeof segment>` is the full state a segment may read.

## Lifecycle

```
             acquire                        release (last holder)
  absent ─────────────▶ active ◀──────────────────────────▶ idle
     ▲                    ▲          acquire (revive)        │
     │                    └──────────────────────────────────┤
     │                                                       │ idle timeout,
     └───────────────────────── evict ───────────────────────┘ maxIdle
```

- **Injecting** dispatches `@@sparse/INJECT` with the keys of the slices the
  call brings in, dependencies first, then starts the epics of the injected
  segments in that order.
- **Releasing** the last hold makes a segment idle. Its dependencies stay held
  by it.
- **Reviving** an idle segment costs nothing: its slice and epics are still
  there.
- **Evicting** stops the epics of the evicted segments, dependents first, then
  dispatches `@@sparse/EVICT`, which removes their slices.
- Segments without a reducer add and remove no slice: when a change involves
  only such segments, no action is dispatched. Dependencies that
  only the evicted segments held are evicted in the same action. Segments that
  expire together are swept together, when the browser is idle.

Reducers outside the segments can handle `SparseActionTypes.EVICT` to drop
data that refers to an evicted segment. A preloaded slice for a segment that is
not present yet is kept, and the segment starts from it when injected.

## Store options

```ts
sparseEnhancer({
  epicRunner, // required once a held segment has epics
  idleTimeout: 60_000, // ms a released segment waits; 0 = evict now, Infinity = never
  whileIdle: 'keep-running', // what an idle segment does
  maxIdle: Infinity, // idle segments kept at most; the least recently used go first
  pauseWhenHidden: true, // stop the idle clock while the page is hidden
});
```

| `whileIdle`    | Reducer | Epics   | Use for                                               |
| -------------- | ------- | ------- | ----------------------------------------------------- |
| `keep-running` | runs    | run     | data kept current by a stream, e.g. live quotes       |
| `pause-epics`  | runs    | stopped | epics that hold subscriptions or poll; restart on use |
| `freeze`       | skipped | stopped | state that is cheap to keep but costly to update      |

A frozen segment resumes from the state it had when it went idle, so actions
dispatched in the meantime are lost to it.

## The store API

`sparseEnhancer` adds `store.sparse`:

```ts
const release = store.sparse.acquire(ordersSegment, pricesSegment);
release(); // idempotent

store.sparse.has(ordersSegment); // or has('orders')
store.sparse.stats(); // { active: ['orders', 'account'], idle: ['prices'] }

store.sparse.batch(() => {
  // injections and evictions caused in here reach the store as one action each
});

const unsubscribe = store.sparse.subscribe((event) => {
  // { type: 'inject' | 'evict', keys } | { type: 'idle' | 'revive', key }
});
```

`acquire` is all or nothing: if any of the segments, or their dependencies,
conflicts with a different segment already using its key, it throws and holds
nothing.

## React

```ts
import { SparseScope, useSparseSegments, createSparseReact } from 'redux-sparse-kit/react';
```

- `<SparseScope segments fallback>` holds the segments while mounted and
  renders its children once they are present. Segments still present from an
  earlier visit render straight away. Holding happens in a layout effect, so
  the fallback never reaches the screen when the segments can be injected
  right away.
- `useSparseSegments(segments)` holds the segments while the calling component
  is mounted and returns whether they are present yet.
- A new array of the same segments on every render does not acquire them
  again.

The bindings find the store in react-redux's context, so they work with any
react-redux 8.1 or later. Pass `createSparseReact({ context })` when the
`<Provider>` was given a custom context.

### Scope checks

In development, `SparseScope` reports reads of a segment's slice made outside
every scope that holds it: such a read works only while some other part of the
tree happens to hold the segment, and breaks once it is evicted.

```tsx
<Provider store={store}>
  {/* reports reads below that no scope holds */}
  <SparseScope segments={[]}>
    <App />
  </SparseScope>
</Provider>
```

A scope makes its segments and their dependencies available to everything
below it, including nested scopes. Reads of static state are never reported.

By default each key is logged once per selector with `console.error`. Pass a
handler to collect them instead, for example to fail end-to-end tests:

```ts
const { SparseScope } = createSparseReact({
  onViolation: ({ key, selector, scope }) => violations.push({ key, selector, scope }),
  checks: true, // default: on outside production builds
});
```

How reads are observed depends on react-redux. When its context value carries
`stateAccessTracking: true`, react-redux reports the first read of each
top-level key by each selector through an `onStateAccess(key, selector)`
callback on the context value; scopes replace that callback for their subtree
and report the selector that made the read. Otherwise scopes pass down a
wrapper of the store whose state is a proxy that sees each top-level read; the
selector is then not known. Checks are compiled out of production builds that
replace `process.env.NODE_ENV`.

## Caveats

- **Server rendering** - segments are injected on the client. On the server
  `SparseScope` renders its fallback.
- **`connect`** - with `onStateAccess`, reads made by `connect` are not
  reported: react-redux reports only the reads of `useSelector`. With the store
  wrapper they are.
- **Reading the whole state** - with the store wrapper, a selector that spreads
  or iterates the whole state reads every key and is reported for each
  segment slice.

## License

[MIT](LICENSE.md)
