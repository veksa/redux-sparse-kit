import type { Action, Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from './segment';
import { sparseEnhancer } from './sparseEnhancer';

const counter =
  (type: string): Reducer<number> =>
  (state = 0, action) =>
    action.type === type ? state + 1 : state;

describe('keys of the static state', () => {
  it('stay with the root reducer when a segment is defined under the same key', () => {
    const store = createStore(
      combineReducers({ sharedA: counter('inc') }),
      sparseEnhancer({ idleTimeout: 0 }),
    );
    defineSegment({ key: 'sharedA', reducer: counter('other') });

    store.dispatch({ type: 'inc' });
    store.dispatch({ type: 'inc' });

    expect(store.getState()).toEqual({ sharedA: 2 });
  });

  it('keep their preloaded values when a segment is defined under the same key', () => {
    defineSegment({ key: 'sharedB', reducer: counter('other') });
    const store = createStore(
      combineReducers({ sharedB: counter('inc') }),
      { sharedB: 5 },
      sparseEnhancer({ idleTimeout: 0 }),
    );

    store.dispatch({ type: 'inc' });

    expect(store.getState()).toEqual({ sharedB: 6 });
  });

  it('cannot be taken by a segment with a reducer', () => {
    const store = createStore(
      combineReducers({ sharedC: counter('inc') }),
      sparseEnhancer({ idleTimeout: 0 }),
    );
    const colliding = defineSegment({ key: 'sharedC', reducer: counter('other') });
    const other = defineSegment({ key: 'notShared', reducer: counter('other') });

    expect(() => store.sparse.acquire(other, colliding)).toThrow(
      'Segment "sharedC" uses the key of a slice of the static state',
    );
    expect(store.sparse.stats()).toEqual({ active: [], idle: [] });
  });

  it('are learned when the root reducer adds or drops keys later', () => {
    const root: Reducer<Record<string, number>> = (state = { base: 0 }, action: Action) => {
      if (action.type === 'add') {
        return { ...state, late: 1 };
      }
      if (action.type === 'drop') {
        const { late: _late, ...rest } = state;
        return rest;
      }
      return state;
    };
    const store = createStore(root, sparseEnhancer({ idleTimeout: 0 }));
    const late = defineSegment({ key: 'late', reducer: counter('late') });

    store.dispatch({ type: 'add' });

    expect(() => store.sparse.acquire(late)).toThrow(
      'Segment "late" uses the key of a slice of the static state',
    );
    expect(store.getState()).toEqual({ base: 0, late: 1 });

    store.dispatch({ type: 'drop' });
    store.sparse.acquire(late);

    expect(store.getState()).toEqual({ base: 0, late: 0 });
  });

  it('are learned again from a replaced root reducer', () => {
    const store = createStore(
      combineReducers({ before: counter('before') }),
      sparseEnhancer({ idleTimeout: 0 }),
    );
    const replaced = defineSegment({ key: 'replacedKey', reducer: counter('other') });

    store.replaceReducer(
      combineReducers({ before: counter('before'), replacedKey: counter('inc') }) as Reducer,
    );

    expect(() => store.sparse.acquire(replaced)).toThrow(
      'Segment "replacedKey" uses the key of a slice of the static state',
    );
  });
});
