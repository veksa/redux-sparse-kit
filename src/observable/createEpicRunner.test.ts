import type { Action, Reducer, StoreEnhancer } from 'redux';
import {
  applyMiddleware,
  combineReducers,
  compose,
  legacy_createStore as createStore,
} from 'redux';
import type { Epic } from 'redux-observable';
import { createEpicMiddleware, ofType } from 'redux-observable';
import { finalize, map } from 'rxjs';
import { defineSegment } from '../segment';
import type { SparseStoreExt } from '../sparseEnhancer';
import { sparseEnhancer } from '../sparseEnhancer';
import { createEpicRunner } from './createEpicRunner';

const count =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

const setup = (dependencies: Record<string, unknown> = {}) => {
  const epicMiddleware = createEpicMiddleware<Action, Action, any>({ dependencies });
  const store = createStore(
    combineReducers({ pongs: count('pong') }),
    compose(
      applyMiddleware(epicMiddleware),
      sparseEnhancer({ epicRunner: createEpicRunner(epicMiddleware), idleTimeout: 0 }),
    ) as StoreEnhancer<SparseStoreExt>,
  );
  return { epicMiddleware, store };
};

const pingEpic: Epic = (action$) =>
  action$.pipe(
    ofType('ping'),
    map(() => ({ type: 'pong' })),
  );

describe('createEpicRunner', () => {
  it('runs the epics of a present segment', () => {
    const { store } = setup();
    const segment = defineSegment({ key: 'pinger', reducer: count('ping'), epics: [pingEpic] });

    store.sparse.acquire(segment);
    store.dispatch({ type: 'ping' });

    expect(store.getState()).toEqual({ pongs: 1, pinger: 1 });
  });

  it('stops the epics of an evicted segment', () => {
    const { store } = setup();
    const segment = defineSegment({ key: 'pinger', reducer: count('ping'), epics: [pingEpic] });

    store.sparse.acquire(segment)();
    store.dispatch({ type: 'ping' });

    expect(store.getState()).toEqual({ pongs: 0 });
  });

  it('runs an epic once after its segment is injected again', () => {
    const { store } = setup();
    const segment = defineSegment({ key: 'pinger', reducer: count('ping'), epics: [pingEpic] });

    store.sparse.acquire(segment)();
    store.sparse.acquire(segment);
    store.dispatch({ type: 'ping' });

    expect(store.getState()).toMatchObject({ pongs: 1 });
  });

  it('completes the epic output when stopped', () => {
    const { store } = setup();
    const finalized = vi.fn();
    const epic: Epic = (action$) => action$.pipe(ofType('never'), finalize(finalized));
    const segment = defineSegment({ key: 'finalizing', reducer: count('x'), epics: [epic] });

    const release = store.sparse.acquire(segment);
    expect(finalized).not.toHaveBeenCalled();

    release();
    expect(finalized).toHaveBeenCalledTimes(1);
  });

  it('gives epics the state, including their own slice, and the dependencies', () => {
    const { store } = setup({ multiplier: 10 });
    const epic: Epic<Action, Action, { reader: number }, { multiplier: number }> = (
      action$,
      state$,
      { multiplier },
    ) =>
      action$.pipe(
        ofType('read'),
        map(() => ({ type: 'result', value: state$.value.reader * multiplier })),
      );
    const results: unknown[] = [];
    const reader = defineSegment({
      key: 'reader',
      reducer: (state: number = 4, action: Action) => {
        if (action.type === 'result') {
          results.push((action as Action & { value: number }).value);
        }
        return state;
      },
      epics: [epic],
    });

    store.sparse.acquire(reader);
    store.dispatch({ type: 'read' });

    expect(results).toEqual([40]);
  });

  it('keeps the name of the epic it runs', () => {
    const names: string[] = [];
    const runner = createEpicRunner({ run: (epic) => names.push(epic.name) });

    runner.run(pingEpic, defineSegment({ key: 'named', reducer: count('x') }));

    expect(names).toEqual(['pingEpic']);
  });
});
