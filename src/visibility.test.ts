import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from './segment';
import type { SparseOptions } from './sparseEnhancer';
import { sparseEnhancer } from './sparseEnhancer';

const counter =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

let visibility: DocumentVisibilityState = 'visible';

const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
};

const setup = (options: SparseOptions = {}) =>
  createStore(
    combineReducers({ app: counter('app') }),
    sparseEnhancer({ idleTimeout: 1000, ...options }),
  );

const elapse = (ms: number) => {
  vi.advanceTimersByTime(ms);
  vi.runOnlyPendingTimers();
};

describe('idle clock and page visibility', () => {
  beforeAll(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });

  afterAll(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  beforeEach(() => {
    visibility = 'visible';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not count the time the page is hidden', () => {
    const store = setup();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(400);
    setVisibility('hidden');
    elapse(10_000);
    setVisibility('visible');
    elapse(599);

    expect(store.sparse.has(orders)).toBe(true);

    elapse(1);

    expect(store.sparse.has(orders)).toBe(false);
  });

  it('starts the clock of a segment released while hidden once the page is visible', () => {
    const store = setup();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    setVisibility('hidden');
    store.sparse.acquire(orders)();
    elapse(5000);

    expect(store.sparse.has(orders)).toBe(true);

    setVisibility('visible');
    elapse(1000);

    expect(store.sparse.has(orders)).toBe(false);
  });

  it('still evicts a segment that expired before the page was hidden', () => {
    const idleCallbacks: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => idleCallbacks.push(callback));
    const store = setup();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    vi.advanceTimersByTime(1000);
    setVisibility('hidden');
    setVisibility('visible');
    idleCallbacks.forEach((callback) => callback());

    expect(store.sparse.has(orders)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('leaves segments that never expire alone', () => {
    const store = setup({ idleTimeout: Infinity });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    store.sparse.acquire(orders)();
    setVisibility('hidden');
    setVisibility('visible');

    expect(vi.getTimerCount()).toBe(0);
    expect(store.sparse.has(orders)).toBe(true);
  });

  it('listens to the page visibility only while segments are idle', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const visibilityCalls = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    const store = setup();
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });
    const prices = defineSegment({ key: 'prices', reducer: counter('prices') });

    expect(visibilityCalls(add)).toBe(0);

    store.sparse.acquire(orders)();
    store.sparse.acquire(prices)();
    expect(visibilityCalls(add)).toBe(1);

    const release = store.sparse.acquire(orders);
    expect(visibilityCalls(remove)).toBe(0);

    elapse(1000);
    expect(visibilityCalls(remove)).toBe(1);

    release();
    expect(visibilityCalls(add)).toBe(2);

    add.mockRestore();
    remove.mockRestore();
  });

  it('never listens to the page visibility when told not to pause', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const store = setup({ pauseWhenHidden: false });

    store.sparse.acquire(defineSegment({ key: 'orders', reducer: counter('orders') }))();

    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toEqual([]);
    add.mockRestore();
  });

  it('keeps counting while hidden when asked to', () => {
    const store = setup({ pauseWhenHidden: false });
    const orders = defineSegment({ key: 'orders', reducer: counter('orders') });

    setVisibility('hidden');
    store.sparse.acquire(orders)();
    elapse(1000);

    expect(store.sparse.has(orders)).toBe(false);
  });
});
