// The examples of the README, checked against the types.
import { configureStore } from '@reduxjs/toolkit';
import { expectTypeOf } from 'expect-type';
import type { Action, Reducer, StoreEnhancer } from 'redux';
import {
  applyMiddleware,
  combineReducers,
  compose,
  legacy_createStore as createStore,
} from 'redux';
import type { Epic } from 'redux-observable';
import { createEpicMiddleware } from 'redux-observable';
import type {
  ScopeStateOf,
  SparseEvent,
  SparseStats,
  SparseStoreExt,
  StateOfSegments,
} from '../src';
import { defineSegment, SparseActionTypes, sparseEnhancer } from '../src';
import { createEpicRunner } from '../src/observable';
import type { ScopeViolation } from '../src/react';
import {
  createSparseReact,
  SparseScope,
  useInjectEpic,
  useInjectReducer,
  useSparseSegments,
} from '../src/react';

interface Account {
  id: string;
}

interface Orders {
  ids: string[];
}

declare const sessionReducer: Reducer<{ user: string }>;
declare const routerReducer: Reducer<{ path: string }>;
declare const accountReducer: Reducer<Account>;
declare const ordersReducer: Reducer<Orders>;
declare const rootEpic: Epic;

// 1. Create the store
const epicMiddleware = createEpicMiddleware();

const store = createStore(
  combineReducers({ session: sessionReducer, router: routerReducer }),
  compose(
    applyMiddleware(epicMiddleware),
    sparseEnhancer({ epicRunner: createEpicRunner(epicMiddleware) }),
  ) as StoreEnhancer<SparseStoreExt>,
);

epicMiddleware.run(rootEpic);

const toolkitStore = configureStore({
  reducer: { session: sessionReducer, router: routerReducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(epicMiddleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(sparseEnhancer({ epicRunner: createEpicRunner(epicMiddleware) })),
});

expectTypeOf(toolkitStore.sparse).toEqualTypeOf(store.sparse);

// 2. Define segments, typing epics
const accountSegment = defineSegment({ key: 'account', reducer: accountReducer });

type OrdersState = StateOfSegments<typeof accountSegment> & { orders: Orders };

declare const loadOrdersEpic: Epic<Action, Action, OrdersState>;

const ordersSegment = defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  deps: [accountSegment],
  epics: [loadOrdersEpic],
  idleTimeout: 5 * 60_000,
  whileIdle: 'pause-epics',
});

// @ts-expect-error reads `account` without depending on it
defineSegment({ key: 'orders', reducer: ordersReducer, epics: [loadOrdersEpic] });

expectTypeOf<ScopeStateOf<typeof ordersSegment>>().toMatchTypeOf<OrdersState>();

declare const pollPricesEpic: Epic;
declare const pricesReducer: Reducer<number[]>;
const pricesSegment = defineSegment({ key: 'prices', reducer: pricesReducer });
const pricePolling = defineSegment({ key: 'pricePolling', epics: [pollPricesEpic] });

const ordersPage = defineSegment({
  key: 'ordersPage',
  deps: [ordersSegment, pricesSegment, pricePolling],
});

expectTypeOf<StateOfSegments<typeof pricePolling | typeof pricesSegment>>().toEqualTypeOf<{
  prices: number[];
}>();

// Store options
sparseEnhancer({
  idleTimeout: 60_000,
  whileIdle: 'keep-running',
  maxIdle: Infinity,
  pauseWhenHidden: true,
});

// The store API
const release: () => void = store.sparse.acquire(ordersSegment, accountSegment);
release();
expectTypeOf(store.sparse.has(ordersSegment)).toEqualTypeOf<boolean>();
expectTypeOf(store.sparse.has('orders')).toEqualTypeOf<boolean>();
expectTypeOf(store.sparse.isStatic('session')).toEqualTypeOf<boolean>();
expectTypeOf(store.sparse.stats()).toEqualTypeOf<SparseStats>();
expectTypeOf(store.sparse.batch(() => 1)).toEqualTypeOf<number>();
const unsubscribe: () => void = store.sparse.subscribe((event) => {
  expectTypeOf(event).toEqualTypeOf<SparseEvent>();
});
unsubscribe();
expectTypeOf(SparseActionTypes.EVICT).toEqualTypeOf<'@@sparse/EVICT'>();

// React
declare const Spinner: () => null;
declare const OrdersTable: () => null;

const page = (
  <SparseScope segments={[ordersPage]} fallback={<Spinner />}>
    <OrdersTable />
  </SparseScope>
);

const root = (
  <SparseScope segments={[]}>
    <OrdersTable />
  </SparseScope>
);

expectTypeOf(useSparseSegments([ordersSegment])).toEqualTypeOf<boolean>();

// Injecting by key
expectTypeOf(useInjectReducer({ key: 'orders', reducer: ordersReducer })).toEqualTypeOf<boolean>();
expectTypeOf(useInjectEpic({ epic: loadOrdersEpic })).toEqualTypeOf<boolean>();
useInjectReducer({
  key: 'orders',
  reducer: ordersReducer,
  idleTimeout: Infinity,
  whileIdle: 'freeze',
});
useInjectEpic({ epic: undefined, idleTimeout: 0 });
// @ts-expect-error the key is required
useInjectReducer({ reducer: ordersReducer });

const violations: ScopeViolation[] = [];
const custom = createSparseReact({
  onViolation: ({ key, selector, scope }) => violations.push({ key, selector, scope }),
  checks: true,
});
const customPage = <custom.SparseScope segments={[ordersSegment]} />;
