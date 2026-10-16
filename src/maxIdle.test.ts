import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from './segment';
import type { SparseOptions } from './sparseEnhancer';
import { sparseEnhancer } from './sparseEnhancer';

const counter =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

const setup = (options: SparseOptions) =>
  createStore(
    combineReducers({ app: counter('app') }),
    sparseEnhancer({ idleTimeout: Infinity, ...options }),
  );

const segment = (key: string) => defineSegment({ key, reducer: counter(key) });

describe('maxIdle', () => {
  it('keeps every idle segment by default', () => {
    const store = setup({});

    for (const key of ['a', 'b', 'c', 'd']) {
      store.sparse.acquire(segment(key))();
    }

    expect(store.sparse.stats().idle).toEqual(['a', 'b', 'c', 'd']);
  });

  it('evicts the segments idle the longest past the limit', () => {
    const store = setup({ maxIdle: 2 });

    for (const key of ['a', 'b', 'c']) {
      store.sparse.acquire(segment(key))();
    }

    expect(store.sparse.stats()).toEqual({ active: [], idle: ['b', 'c'] });
  });

  it('counts a revived segment as idle from the moment it is released again', () => {
    const store = setup({ maxIdle: 2 });
    const a = segment('a');

    store.sparse.acquire(a)();
    store.sparse.acquire(segment('b'))();
    store.sparse.acquire(a)();
    store.sparse.acquire(segment('c'))();

    expect(store.sparse.stats().idle.sort()).toEqual(['a', 'c']);
  });

  it('evicts a released segment right away with a limit of zero', () => {
    const store = setup({ maxIdle: 0 });
    const a = segment('a');

    store.sparse.acquire(a)();

    expect(store.sparse.has(a)).toBe(false);
  });

  it('evicts the dependencies only an evicted segment held', () => {
    const store = setup({ maxIdle: 1 });
    const account = segment('account');
    const orders = defineSegment({ key: 'orders', reducer: counter('orders'), deps: [account] });

    store.sparse.acquire(orders)();
    store.sparse.acquire(segment('prices'))();

    expect(store.getState()).toEqual({ app: 0, prices: 0 });
  });

  it('rejects an invalid limit', () => {
    expect(() => sparseEnhancer({ maxIdle: -1 })).toThrow('maxIdle must be a non-negative number');
    expect(() => sparseEnhancer({ maxIdle: Number.NaN })).toThrow(RangeError);
  });
});
