import type { Action, Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from './segment';
import type { EpicRunner, SparseEvent, SparseOptions } from './sparseEnhancer';
import { SparseActionTypes, sparseEnhancer } from './sparseEnhancer';

const counter =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

const setup = (options: SparseOptions = {}) => {
  const log: string[] = [];
  const actions: Action[] = [];
  const events: SparseEvent[] = [];
  const runner: EpicRunner = {
    run(epic, segment) {
      log.push(`start ${segment.key}:${epic.name}`);
      return () => log.push(`stop ${segment.key}:${epic.name}`);
    },
  };
  const recorder: Reducer<null> = (state = null, action) => {
    if (action.type === SparseActionTypes.INJECT || action.type === SparseActionTypes.EVICT) {
      actions.push(action);
    }
    return state;
  };
  const store = createStore(
    combineReducers({ app: counter('app'), recorder }),
    sparseEnhancer({ epicRunner: runner, idleTimeout: 0, ...options }),
  );
  store.sparse.subscribe((event) => events.push(event));
  return { actions, events, log, store };
};

function poll() {}
function watch() {}

describe('a segment with epics only', () => {
  const poller = defineSegment({ key: 'poller', epics: [poll] });

  it('starts its epics without touching the state', () => {
    const { actions, events, log, store } = setup();
    const before = store.getState();

    store.sparse.acquire(poller);

    expect(log).toEqual(['start poller:poll']);
    expect(actions).toEqual([]);
    expect(events).toEqual([{ type: 'inject', keys: ['poller'] }]);
    expect(store.getState()).toBe(before);
    expect(store.sparse.has(poller)).toBe(true);
    expect(store.sparse.stats()).toEqual({ active: ['poller'], idle: [] });
  });

  it('stops its epics when evicted, without an action', () => {
    const { actions, events, log, store } = setup();

    store.sparse.acquire(poller)();

    expect(log).toEqual(['start poller:poll', 'stop poller:poll']);
    expect(actions).toEqual([]);
    expect(events).toEqual([
      { type: 'inject', keys: ['poller'] },
      { type: 'evict', keys: ['poller'] },
    ]);
  });

  it('stops only its epics when frozen', () => {
    const { log, store } = setup({ idleTimeout: Infinity, whileIdle: 'freeze' });

    store.sparse.acquire(poller)();
    store.dispatch({ type: 'app' });

    expect(log).toEqual(['start poller:poll', 'stop poller:poll']);
    expect(store.getState().app).toBe(1);
  });

  it('leaves a static slice with the same key alone', () => {
    const { store } = setup();
    const named = defineSegment({ key: 'app', epics: [watch] });

    store.sparse.acquire(named);
    store.dispatch({ type: 'app' });

    expect(store.getState()).toEqual({ app: 1, recorder: null });
  });
});

describe('segments with and without a reducer together', () => {
  it('names only the slices in the actions and every segment in the events', () => {
    const { actions, events, log, store } = setup();
    const poller = defineSegment({ key: 'mixedPoller', epics: [poll] });
    const orders = defineSegment({
      key: 'mixedOrders',
      reducer: counter('orders'),
      deps: [poller],
      epics: [watch],
    });

    store.sparse.acquire(orders)();

    expect(actions).toEqual([
      { type: SparseActionTypes.INJECT, payload: { keys: ['mixedOrders'] } },
      { type: SparseActionTypes.EVICT, payload: { keys: ['mixedOrders'] } },
    ]);
    expect(events).toEqual([
      { type: 'inject', keys: ['mixedPoller', 'mixedOrders'] },
      { type: 'evict', keys: ['mixedOrders', 'mixedPoller'] },
    ]);
    expect(log).toEqual([
      'start mixedPoller:poll',
      'start mixedOrders:watch',
      'stop mixedOrders:watch',
      'stop mixedPoller:poll',
    ]);
  });
});

describe('a segment that only bundles its deps', () => {
  it('holds its deps while present and releases them when evicted', () => {
    const { store } = setup();
    const orders = defineSegment({ key: 'bundledOrders', reducer: counter('orders') });
    const prices = defineSegment({ key: 'bundledPrices', reducer: counter('prices') });
    const page = defineSegment({ key: 'ordersPage', deps: [orders, prices] });

    const release = store.sparse.acquire(page);

    expect(store.getState()).toEqual({
      app: 0,
      recorder: null,
      bundledOrders: 0,
      bundledPrices: 0,
    });

    release();

    expect(store.getState()).toEqual({ app: 0, recorder: null });
  });
});

describe('a slice evicted within a batch', () => {
  it('keeps reducing until the batch ends', () => {
    const { store } = setup();
    const orders = defineSegment({ key: 'batchedOrders', reducer: counter('orders') });
    const release = store.sparse.acquire(orders);
    const seen: unknown[] = [];

    store.sparse.batch(() => {
      release();
      store.dispatch({ type: 'orders' });
      seen.push((store.getState() as Record<string, unknown>).batchedOrders);
    });

    expect(seen).toEqual([1]);
    expect(store.getState()).toEqual({ app: 0, recorder: null });
  });
});
