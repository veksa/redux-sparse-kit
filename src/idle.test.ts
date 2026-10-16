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
  const actions: Action[] = [];
  const log: Reducer<null> = (state = null, action) => {
    if (action.type === SparseActionTypes.INJECT || action.type === SparseActionTypes.EVICT) {
      actions.push(action);
    }
    return state;
  };
  const store = createStore(combineReducers({ log }), sparseEnhancer(options));
  return { actions, store };
};

const evictAction = (...keys: string[]) => ({
  type: SparseActionTypes.EVICT,
  payload: { keys },
});

describe('idle segments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a released segment for one minute by default', () => {
    const { actions, store } = setup();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(59_999);

    expect(store.sparse.has(orders)).toBe(true);
    expect(store.getState()).toEqual({ log: null, orders: 0 });

    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();

    expect(store.sparse.has(orders)).toBe(false);
    expect(store.getState()).toEqual({ log: null });
    expect(actions[actions.length - 1]).toEqual(evictAction('orders'));
  });

  it('keeps reducing an idle segment', () => {
    const { store } = setup({ idleTimeout: 1000 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    store.dispatch({ type: 'orders' });

    expect(store.getState()).toEqual({ log: null, orders: 1 });
  });

  it('revives an idle segment without injecting it again', () => {
    const { actions, store } = setup({ idleTimeout: 1000 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    store.dispatch({ type: 'orders' });
    actions.length = 0;

    vi.advanceTimersByTime(999);
    const release = store.sparse.acquire(orders);
    vi.advanceTimersByTime(10_000);

    expect(actions).toEqual([]);
    expect(store.getState()).toEqual({ log: null, orders: 1 });

    release();
    vi.advanceTimersByTime(1000);
    vi.runOnlyPendingTimers();

    expect(store.sparse.has(orders)).toBe(false);
  });

  it('keeps the epics of an idle segment running', () => {
    const stopped: string[] = [];
    const runner: EpicRunner = { run: (_epic, segment) => () => stopped.push(segment.key) };
    const { store } = setup({ idleTimeout: 1000, epicRunner: runner });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), epics: [() => 0] });

    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(999);

    expect(stopped).toEqual([]);

    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();

    expect(stopped).toEqual(['orders']);
  });

  it('lets a segment override the idle timeout of the store', () => {
    const { store } = setup({ idleTimeout: 1000 });
    const quick = defineSegment({ key: 'quick', reducer: counter('quick'), idleTimeout: 0 });
    const slow = defineSegment({ key: 'slow', reducer: counter('slow'), idleTimeout: 5000 });

    store.sparse.acquire(quick, slow)();

    expect(store.sparse.has(quick)).toBe(false);

    vi.advanceTimersByTime(1000);
    vi.runOnlyPendingTimers();
    expect(store.sparse.has(slow)).toBe(true);

    vi.advanceTimersByTime(4000);
    vi.runOnlyPendingTimers();
    expect(store.sparse.has(slow)).toBe(false);
  });

  it('never evicts with an infinite or overflowing idle timeout', () => {
    const { store } = setup({ idleTimeout: Infinity });
    const forever = defineSegment({ key: 'forever', reducer: counter('forever') });
    const huge = defineSegment({ key: 'huge', reducer: counter('huge'), idleTimeout: 2 ** 31 });

    store.sparse.acquire(forever, huge)();
    vi.advanceTimersByTime(2 ** 31 + 1);
    vi.runOnlyPendingTimers();

    expect(store.sparse.stats()).toEqual({ active: [], idle: ['forever', 'huge'] });
  });

  it('evicts the segments that expire together with a single action', () => {
    const { actions, store } = setup({ idleTimeout: 1000 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });
    const prices = defineSegment({ key: 'prices', reducer: counter('prices') });

    store.sparse.acquire(orders)();
    store.sparse.acquire(prices)();
    actions.length = 0;

    vi.advanceTimersByTime(1000);
    vi.runOnlyPendingTimers();

    expect(actions).toEqual([evictAction('orders', 'prices')]);
  });

  it('keeps a dependency while an idle dependent holds it, then evicts both together', () => {
    const { actions, store } = setup({ idleTimeout: 1000 });
    const account = defineSegment({ key: 'account', reducer: counter('account'), idleTimeout: 0 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });

    store.sparse.acquire(orders)();
    actions.length = 0;

    expect(store.sparse.stats()).toEqual({ active: ['account'], idle: ['orders'] });

    vi.advanceTimersByTime(1000);
    vi.runOnlyPendingTimers();

    expect(actions).toEqual([evictAction('orders', 'account')]);
  });

  it('keeps a dependency that is still held elsewhere when its dependent is evicted', () => {
    const { store } = setup({ idleTimeout: 1000 });
    const account = defineSegment({ key: 'account', reducer: counter('account') });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });

    store.sparse.acquire(account);
    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(1000);
    vi.runOnlyPendingTimers();

    expect(store.sparse.stats()).toEqual({ active: ['account'], idle: [] });
  });

  it('does not evict a segment revived after it expired but before the sweep', () => {
    const { store } = setup({ idleTimeout: 1000 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(1000);
    store.sparse.acquire(orders);
    vi.runOnlyPendingTimers();

    expect(store.sparse.has(orders)).toBe(true);
  });

  it('sweeps expired segments when the browser is idle', () => {
    const idleCallbacks: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void, options: unknown) => {
      expect(options).toEqual({ timeout: 1000 });
      idleCallbacks.push(callback);
    });
    const { store } = setup({ idleTimeout: 1000 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });
    const prices = defineSegment({ key: 'prices', reducer: counter('prices'), idleTimeout: 1500 });

    store.sparse.acquire(orders, prices)();
    vi.advanceTimersByTime(1500);

    expect(idleCallbacks).toHaveLength(1);
    expect(store.sparse.has(orders)).toBe(true);

    idleCallbacks[0]!();

    expect(store.sparse.stats()).toEqual({ active: [], idle: [] });
  });

  it('reports segments going idle and being revived', () => {
    const { store } = setup({ idleTimeout: 1000 });
    const events: SparseEvent[] = [];
    store.sparse.subscribe((event) => events.push(event));
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    store.sparse.acquire(orders);

    expect(events).toEqual([
      { type: 'inject', keys: ['orders'] },
      { type: 'idle', key: 'orders' },
      { type: 'revive', key: 'orders' },
    ]);
  });

  it('lists active and idle segments, leaving out those not injected yet', () => {
    const { store } = setup({ idleTimeout: 1000 });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });
    const prices = defineSegment({ key: 'prices', reducer: counter('prices') });

    store.sparse.acquire(orders);
    store.sparse.acquire(prices)();

    store.sparse.batch(() => {
      store.sparse.acquire(defineSegment({ key: 'pending', reducer: counter('pending') }));
      expect(store.sparse.stats()).toEqual({ active: ['orders'], idle: ['prices'] });
    });
  });

  it('rejects an invalid idle timeout', () => {
    expect(() => sparseEnhancer({ idleTimeout: -1 })).toThrow(RangeError);
    expect(() => sparseEnhancer({ idleTimeout: Number.NaN })).toThrow(RangeError);
  });
});
