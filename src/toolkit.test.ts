import { configureStore, createSlice } from '@reduxjs/toolkit';
import type { Action } from 'redux';
import type { Epic } from 'redux-observable';
import { createEpicMiddleware, ofType } from 'redux-observable';
import { map } from 'rxjs';
import { createEpicRunner } from './observable';
import { defineSegment } from './segment';
import { sparseEnhancer } from './sparseEnhancer';

const session = createSlice({
  name: 'session',
  initialState: { user: 'guest' },
  reducers: {},
});

const orders = createSlice({
  name: 'orders',
  initialState: { loaded: 0 },
  reducers: {
    loaded: (state) => {
      state.loaded++;
    },
  },
});

const loadEpic: Epic = (action$) =>
  action$.pipe(
    ofType('orders/load'),
    map(() => orders.actions.loaded()),
  );

describe("Redux Toolkit's configureStore", () => {
  it('takes sparseEnhancer as an enhancer', () => {
    const epicMiddleware = createEpicMiddleware<Action, Action>();
    const store = configureStore({
      reducer: { session: session.reducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(epicMiddleware),
      enhancers: (getDefaultEnhancers) =>
        getDefaultEnhancers().concat(
          sparseEnhancer({ epicRunner: createEpicRunner(epicMiddleware), idleTimeout: 0 }),
        ),
    });
    const ordersSegment = defineSegment({
      key: 'toolkitOrders',
      reducer: orders.reducer,
      epics: [loadEpic],
    });

    const release = store.sparse.acquire(ordersSegment);
    store.dispatch({ type: 'orders/load' });

    expect(store.getState()).toEqual({
      session: { user: 'guest' },
      toolkitOrders: { loaded: 1 },
    });

    release();

    expect(store.getState()).toEqual({ session: { user: 'guest' } });
  });
});
