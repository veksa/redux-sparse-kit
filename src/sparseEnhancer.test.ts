import type { Action, Middleware, Reducer, StoreEnhancer } from 'redux';
import {
  applyMiddleware,
  combineReducers,
  compose,
  legacy_createStore as createStore,
} from 'redux';
import type { EpicRunner, SparseEvent, SparseStoreExt } from './sparseEnhancer';
import { SparseActionTypes, sparseEnhancer } from './sparseEnhancer';
import { defineSegment } from './segment';

const counter =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

const recorder = () => {
  const actions: Action[] = [];
  const reducer: Reducer<Action[]> = (state = [], action) => {
    actions.push(action);
    return state;
  };
  return { actions, reducer };
};

const createSparseStore = (staticReducer: Reducer = combineReducers({ app: counter('app') })) =>
  createStore(staticReducer, sparseEnhancer({ idleTimeout: 0 }));

describe('sparseEnhancer', () => {
  it('keeps the static state owned by the root reducer', () => {
    const store = createSparseStore();

    store.dispatch({ type: 'app' });

    expect(store.getState()).toEqual({ app: 1 });
  });

  it('injects a held segment with its initial state', () => {
    const store = createSparseStore();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders);

    expect(store.sparse.has(orders)).toBe(true);
    expect(store.getState()).toEqual({ app: 0, orders: 0 });

    store.dispatch({ type: 'orders' });

    expect(store.getState()).toEqual({ app: 0, orders: 1 });
  });

  it('injects the segments of one acquire with a single action, deps first', () => {
    const { actions, reducer } = recorder();
    const store = createSparseStore(combineReducers({ log: reducer }));
    const account = defineSegment({ key: 'account', reducer: counter('account') });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });
    const prices = defineSegment({ key: 'prices', reducer: counter('prices') });

    actions.length = 0;
    store.sparse.acquire(orders, prices);

    expect(actions).toEqual([
      { type: SparseActionTypes.INJECT, payload: { keys: ['account', 'orders', 'prices'] } },
    ]);
  });

  it('evicts a released segment, dependents before their deps', () => {
    const { actions, reducer } = recorder();
    const store = createSparseStore(combineReducers({ log: reducer }));
    const account = defineSegment({ key: 'account', reducer: counter('account') });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });

    const release = store.sparse.acquire(orders);
    actions.length = 0;
    release();

    expect(actions).toEqual([
      { type: SparseActionTypes.EVICT, payload: { keys: ['orders', 'account'] } },
    ]);
    expect(store.getState()).toEqual({ log: [] });
    expect(store.sparse.has(orders)).toBe(false);
    expect(store.sparse.has(account)).toBe(false);
  });

  it('keeps a segment while anything still holds it', () => {
    const store = createSparseStore();
    const account = defineSegment({ key: 'account', reducer: counter('account') });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });
    const positions = defineSegment({
      key: 'positions',
      reducer: counter('positions'),
      deps: [account],
    });

    const releaseOrders = store.sparse.acquire(orders);
    const releaseOrdersAgain = store.sparse.acquire(orders);
    const releasePositions = store.sparse.acquire(positions);

    releaseOrders();
    releaseOrders();
    expect(store.sparse.has(orders)).toBe(true);

    releaseOrdersAgain();
    expect(store.sparse.has(orders)).toBe(false);
    expect(store.sparse.has(account)).toBe(true);

    releasePositions();
    expect(store.sparse.has(account)).toBe(false);
  });

  it('does nothing when a segment is released and held again within a batch', () => {
    const { actions, reducer } = recorder();
    const store = createSparseStore(combineReducers({ log: reducer }));
    const account = defineSegment({ key: 'account', reducer: counter('account') });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });

    const release = store.sparse.acquire(orders);
    store.dispatch({ type: 'orders' });
    actions.length = 0;

    store.sparse.batch(() => {
      release();
      store.sparse.acquire(orders);
    });

    expect(actions).toEqual([]);
    expect(store.getState()).toEqual({ log: [], account: 0, orders: 1 });
  });

  it('lets static reducers see the evicted keys', () => {
    const evicted: string[][] = [];
    const cleanup: Reducer<null> = (state = null, action) => {
      if (action.type === SparseActionTypes.EVICT) {
        evicted.push([...(action as unknown as { payload: { keys: string[] } }).payload.keys]);
      }
      return state;
    };
    const store = createSparseStore(combineReducers({ cleanup }));
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();

    expect(evicted).toEqual([['orders']]);
  });

  it('returns the same state when nothing changed', () => {
    const store = createSparseStore();
    store.sparse.acquire(defineSegment({ key: 'orders', reducer: counter('orders') }));

    const before = store.getState();
    store.dispatch({ type: 'unrelated' });

    expect(store.getState()).toBe(before);
  });

  it('starts a segment from its preloaded slice without shape warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });
    const store = createStore(
      combineReducers({ app: counter('app') }),
      { app: 1, orders: 5 } as { app: number },
      sparseEnhancer({ idleTimeout: 0 }),
    );

    store.dispatch({ type: 'app' });
    expect(store.getState()).toEqual({ app: 2, orders: 5 });

    store.sparse.acquire(orders);
    store.dispatch({ type: 'orders' });

    expect(store.getState()).toEqual({ app: 2, orders: 6 });
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it('refuses a different segment under a key that is already present', () => {
    const store = createSparseStore();
    store.sparse.acquire(defineSegment({ key: 'orders', reducer: counter('orders') }));

    expect(() =>
      store.sparse.acquire(defineSegment({ key: 'orders', reducer: counter('other') })),
    ).toThrow('Two different segments use the key "orders"');
  });

  it('leaves no holds behind when an acquire is refused', () => {
    const { actions, reducer } = recorder();
    const store = createSparseStore(combineReducers({ log: reducer }));
    const account = defineSegment({ key: 'account', reducer: counter('account') });
    const otherAccount = defineSegment({ key: 'account', reducer: counter('other') });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });
    const prices = defineSegment({ key: 'prices', reducer: counter('prices') });

    const releaseOther = store.sparse.acquire(otherAccount);
    actions.length = 0;

    expect(() => store.sparse.acquire(prices, orders)).toThrow(
      'Two different segments use the key "account"',
    );
    expect(() =>
      store.sparse.acquire(prices, defineSegment({ key: 'prices', reducer: counter('x') })),
    ).toThrow('Two different segments use the key "prices"');
    expect(actions).toEqual([]);
    expect(store.sparse.has(prices)).toBe(false);
    expect(store.sparse.has(orders)).toBe(false);

    releaseOther();
    expect(store.sparse.has('account')).toBe(false);
  });

  it('skips a segment acquired and released before it reached the store', () => {
    const { actions, reducer } = recorder();
    const store = createSparseStore(combineReducers({ log: reducer }));
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    actions.length = 0;
    store.sparse.batch(() => {
      store.sparse.acquire(orders)();
    });

    expect(actions).toEqual([]);
    expect(store.getState()).toEqual({ log: [] });
  });

  it('reports presence by segment or by key', () => {
    const store = createSparseStore();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.batch(() => {
      store.sparse.acquire(orders);
      expect(store.sparse.has(orders)).toBe(false);
    });

    expect(store.sparse.has(orders)).toBe(true);
    expect(store.sparse.has('orders')).toBe(true);
    expect(store.sparse.has('missing')).toBe(false);
  });

  it('keeps the segments when the root reducer is replaced', () => {
    const store = createSparseStore();
    store.sparse.acquire(defineSegment({ key: 'orders', reducer: counter('orders') }));

    store.replaceReducer(combineReducers({ app: counter('app'), extra: counter('extra') }));
    store.dispatch({ type: 'orders' });

    expect(store.getState()).toEqual({ app: 0, extra: 0, orders: 1 });
  });

  it('reports injections and evictions to subscribers', () => {
    const store = createSparseStore();
    const events: SparseEvent[] = [];
    const unsubscribe = store.sparse.subscribe((event) => events.push(event));
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    unsubscribe();
    store.sparse.acquire(orders);

    expect(events).toEqual([
      { type: 'inject', keys: ['orders'] },
      { type: 'evict', keys: ['orders'] },
    ]);
  });

  it('composes with other enhancers', () => {
    const seen: string[] = [];
    const middleware: Middleware = () => (next) => (action) => {
      seen.push((action as Action).type);
      return next(action);
    };
    const store = createStore(
      combineReducers({ app: counter('app') }),
      compose(
        applyMiddleware(middleware),
        sparseEnhancer({ idleTimeout: 0 }),
      ) as StoreEnhancer<SparseStoreExt>,
    );

    store.sparse.acquire(defineSegment({ key: 'orders', reducer: counter('orders') }));
    store.dispatch({ type: 'orders' });

    expect(store.getState()).toEqual({ app: 0, orders: 1 });
    expect(seen).toContain('orders');
  });
});

describe('sparseEnhancer epics', () => {
  const createRunner = (getState: () => Record<string, unknown>) => {
    const log: string[] = [];
    const runner: EpicRunner = {
      run(epic, segment) {
        log.push(`start ${segment.key}:${epic.name} present=${segment.key in getState()}`);
        return () => {
          log.push(`stop ${segment.key}:${epic.name} present=${segment.key in getState()}`);
        };
      },
    };
    return { log, runner };
  };

  const setup = () => {
    let store: ReturnType<typeof createSparseStore>;
    const { log, runner } = createRunner(() => store.getState());
    store = createStore(
      combineReducers({ app: counter('app') }),
      sparseEnhancer({ epicRunner: runner, idleTimeout: 0 }),
    );
    return { log, store };
  };

  function accountEpic() {}
  function ordersEpic() {}
  function ordersSecondEpic() {}

  const account = defineSegment({
    key: 'epicAccount',
    reducer: counter('account'),
    epics: [accountEpic],
  });
  const orders = defineSegment({
    key: 'epicOrders',
    reducer: counter('orders'),
    deps: [account],
    epics: [ordersEpic, ordersSecondEpic],
  });

  it('starts epics once their slices are present, deps first', () => {
    const { log, store } = setup();

    store.sparse.acquire(orders);

    expect(log).toEqual([
      'start epicAccount:accountEpic present=true',
      'start epicOrders:ordersEpic present=true',
      'start epicOrders:ordersSecondEpic present=true',
    ]);
  });

  it('stops epics while their slices are still present, dependents first', () => {
    const { log, store } = setup();
    const release = store.sparse.acquire(orders);
    log.length = 0;

    release();

    expect(log).toEqual([
      'stop epicOrders:ordersEpic present=true',
      'stop epicOrders:ordersSecondEpic present=true',
      'stop epicAccount:accountEpic present=true',
    ]);
  });

  it('keeps epics running for a segment held again within a batch', () => {
    const { log, store } = setup();
    const release = store.sparse.acquire(orders);
    log.length = 0;

    store.sparse.batch(() => {
      release();
      store.sparse.acquire(orders);
    });

    expect(log).toEqual([]);
  });

  it('starts epics again for a segment injected again', () => {
    const { log, store } = setup();
    store.sparse.acquire(account)();
    log.length = 0;

    store.sparse.acquire(account);

    expect(log).toEqual(['start epicAccount:accountEpic present=true']);
  });

  it('requires an epic runner for segments with epics', () => {
    const store = createSparseStore();

    expect(() => store.sparse.acquire(orders)).toThrow(
      'Segment "epicOrders" has epics, but sparseEnhancer was created without an epicRunner',
    );
    expect(store.sparse.has(orders)).toBe(false);
  });
});
