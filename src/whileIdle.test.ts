import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import type { WhileIdle } from './segment';
import { defineSegment } from './segment';
import type { EpicRunner, SparseOptions } from './sparseEnhancer';
import { sparseEnhancer } from './sparseEnhancer';

const counter =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

const setup = (options: SparseOptions = {}) => {
  const log: string[] = [];
  const runner: EpicRunner = {
    run(_epic, segment) {
      log.push(`start ${segment.key}`);
      return () => log.push(`stop ${segment.key}`);
    },
  };
  const store = createStore(
    combineReducers({ app: counter('app') }),
    sparseEnhancer({ idleTimeout: 1000, epicRunner: runner, ...options }),
  );
  return { log, store };
};

const ordersWith = (whileIdle?: WhileIdle) =>
  defineSegment({ key: 'orders', reducer: counter('orders'), epics: [() => 0], whileIdle });

describe('whileIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an idle segment running by default', () => {
    const { log, store } = setup();

    store.sparse.acquire(ordersWith())();
    store.dispatch({ type: 'orders' });

    expect(log).toEqual(['start orders']);
    expect(store.getState()).toEqual({ app: 0, orders: 1 });
  });

  describe('pause-epics', () => {
    it('stops the epics of an idle segment and keeps its reducer running', () => {
      const { log, store } = setup({ whileIdle: 'pause-epics' });

      store.sparse.acquire(ordersWith())();
      store.dispatch({ type: 'orders' });

      expect(log).toEqual(['start orders', 'stop orders']);
      expect(store.getState()).toEqual({ app: 0, orders: 1 });
    });

    it('starts the epics again when the segment is revived', () => {
      const { log, store } = setup({ whileIdle: 'pause-epics' });
      const orders = ordersWith();

      store.sparse.acquire(orders)();
      store.sparse.acquire(orders);

      expect(log).toEqual(['start orders', 'stop orders', 'start orders']);
    });

    it('does not stop the epics twice when the paused segment is evicted', () => {
      const { log, store } = setup({ whileIdle: 'pause-epics' });

      store.sparse.acquire(ordersWith())();
      vi.advanceTimersByTime(1000);
      vi.runOnlyPendingTimers();

      expect(log).toEqual(['start orders', 'stop orders']);
      expect(store.sparse.has('orders')).toBe(false);
    });

    it('does not start the epics of a segment that went idle before it was injected', () => {
      const { log, store } = setup({ whileIdle: 'pause-epics' });
      const orders = ordersWith();

      store.sparse.batch(() => {
        store.sparse.acquire(orders)();
      });

      expect(log).toEqual([]);
      expect(store.getState()).toEqual({ app: 0, orders: 0 });

      store.sparse.acquire(orders);

      expect(log).toEqual(['start orders']);
    });

    it('starts the epics once when revived before it was injected', () => {
      const { log, store } = setup({ whileIdle: 'pause-epics' });
      const orders = ordersWith();

      store.sparse.batch(() => {
        store.sparse.acquire(orders)();
        store.sparse.acquire(orders);
      });

      expect(log).toEqual(['start orders']);
    });
  });

  describe('freeze', () => {
    it('stops the epics and keeps the state of an idle segment as it was', () => {
      const { log, store } = setup({ whileIdle: 'freeze' });

      store.sparse.acquire(ordersWith())();
      store.dispatch({ type: 'orders' });

      expect(log).toEqual(['start orders', 'stop orders']);
      expect(store.getState()).toEqual({ app: 0, orders: 0 });
    });

    it('resumes the reducer and the epics when the segment is revived', () => {
      const { log, store } = setup({ whileIdle: 'freeze' });
      const orders = ordersWith();

      store.sparse.acquire(orders)();
      store.dispatch({ type: 'orders' });
      store.sparse.acquire(orders);
      store.dispatch({ type: 'orders' });

      expect(log).toEqual(['start orders', 'stop orders', 'start orders']);
      expect(store.getState()).toEqual({ app: 0, orders: 1 });
    });

    it('still gives a segment frozen before it was injected its initial state', () => {
      const { store } = setup({ whileIdle: 'freeze' });

      store.sparse.batch(() => {
        store.sparse.acquire(ordersWith())();
      });

      expect(store.getState()).toEqual({ app: 0, orders: 0 });
    });
  });

  it('lets a segment override the policy of the store', () => {
    const { log, store } = setup({ whileIdle: 'freeze' });

    store.sparse.acquire(ordersWith('keep-running'))();
    store.dispatch({ type: 'orders' });

    expect(log).toEqual(['start orders']);
    expect(store.getState()).toEqual({ app: 0, orders: 1 });
  });

  it('rejects an unknown policy', () => {
    expect(() => sparseEnhancer({ whileIdle: 'sleep' as WhileIdle })).toThrow(
      'whileIdle must be one of keep-running, pause-epics, freeze',
    );
  });
});
