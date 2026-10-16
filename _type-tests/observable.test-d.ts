import type { Action } from 'redux';
import type { Epic } from 'redux-observable';
import { defineSegment } from '../src';

interface Account {
  id: string;
}

interface Orders {
  ids: string[];
}

declare const accountReducer: (state: Account | undefined, action: Action) => Account;
declare const ordersReducer: (state: Orders | undefined, action: Action) => Orders;

const account = defineSegment({ key: 'account', reducer: accountReducer });

// redux-observable's default `Epic` does not declare a state: it reads none.
declare const stateless: Epic;
declare const readsUnknown: Epic<Action, Action, unknown>;
declare const readsAny: Epic<Action, Action, any>;
declare const readsOwnAndDeps: Epic<Action, Action, { orders: Orders; account: Account }>;

defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  deps: [account],
  epics: [stateless, readsUnknown, readsAny, readsOwnAndDeps],
});

defineSegment({
  key: 'orders',
  reducer: ordersReducer,
  // @ts-expect-error `account` is read but not declared as a dependency
  epics: [readsOwnAndDeps],
});
