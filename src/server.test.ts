// @vitest-environment node
import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from './segment';
import { sparseEnhancer } from './sparseEnhancer';

const counter: Reducer<number> = (state = 0) => state;

describe('without a document', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects and evicts segments on its idle clock', () => {
    expect(typeof document).toBe('undefined');

    const store = createStore(
      combineReducers({ app: counter }),
      sparseEnhancer({ idleTimeout: 1000 }),
    );
    const orders = defineSegment({ key: 'orders', reducer: counter });

    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(1000);
    vi.runOnlyPendingTimers();

    expect(store.getState()).toEqual({ app: 0 });
  });
});
