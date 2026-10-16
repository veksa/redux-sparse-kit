import { expectTypeOf } from 'expect-type';
import type { ScopeStateOf, Segment, StateOfSegments } from '../src';
import { defineSegment } from '../src';

declare module '../src/segment' {
  interface StaticState {
    router: { path: string };
  }
}

interface Account {
  id: string;
}

interface Orders {
  ids: string[];
}

declare const accountReducer: (state: Account | undefined, action: unknown) => Account;
declare const ordersReducer: (state: Orders | undefined, action: unknown) => Orders;

interface StateObservable<State> {
  readonly value: State;
}

type Epic<State> = (action$: unknown, state$: StateObservable<State>, deps: unknown) => unknown;

const account = defineSegment({ key: 'account', reducer: accountReducer });

// The key, state and deps are inferred from the options.
expectTypeOf(account).toEqualTypeOf<Segment<'account', Account, []>>();

const orders = defineSegment({ key: 'orders', reducer: ordersReducer, deps: [account] });

expectTypeOf(orders).toEqualTypeOf<Segment<'orders', Orders, readonly [typeof account]>>();

// A segment reads the static state, its own slice and its direct deps.
expectTypeOf<ScopeStateOf<typeof orders>>().toEqualTypeOf<
  { router: { path: string } } & { orders: Orders; account: Account }
>();

expectTypeOf<StateOfSegments<typeof account | typeof orders>>().toEqualTypeOf<{
  account: Account;
  orders: Orders;
}>();

declare const readsOwnAndDeps: Epic<{ orders: Orders; account: Account }>;
declare const readsStatic: Epic<{ router: { path: string } }>;
declare const untyped: (action$: any, state$: any) => unknown;
// A `void` or `unknown` state is not read, so it never needs a dependency.
declare const readsNothing: Epic<void>;
declare const readsUnknown: Epic<unknown>;

defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  deps: [account],
  epics: [readsOwnAndDeps, readsStatic, untyped],
});

defineSegment({ key: 'orders', reducer: ordersReducer, epics: [readsNothing, readsUnknown] });

declare const readsUndeclared: Epic<{ orders: Orders; account: Account }>;

defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  // @ts-expect-error `account` is read but not declared as a dependency
  epics: [readsUndeclared],
});

declare const readsWrongType: Epic<{ orders: { ids: number[] } }>;

defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  // @ts-expect-error the epic expects a different shape of the segment's own slice
  epics: [readsWrongType],
});
