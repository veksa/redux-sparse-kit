import { defineSegment, isSegmentKey } from './segment';

const counter = (state = 0) => state;

describe('defineSegment', () => {
  it('keeps the given options', () => {
    const epic = () => undefined;
    const dep = defineSegment({ key: 'dep', reducer: counter });
    const segment = defineSegment({
      key: 'orders',
      reducer: counter,
      deps: [dep],
      epics: [epic],
      idleTimeout: 1000,
      whileIdle: 'freeze',
    });

    expect(segment).toEqual({
      key: 'orders',
      reducer: counter,
      deps: [dep],
      epics: [epic],
      idleTimeout: 1000,
      whileIdle: 'freeze',
    });
  });

  it('defaults to no deps, no epics and the store settings', () => {
    const segment = defineSegment({ key: 'plain', reducer: counter });

    expect(segment.deps).toEqual([]);
    expect(segment.epics).toEqual([]);
    expect(segment.idleTimeout).toBeUndefined();
    expect(segment.whileIdle).toBeUndefined();
  });

  it('returns a frozen definition that does not share the given arrays', () => {
    const deps = [defineSegment({ key: 'a', reducer: counter })];
    const segment = defineSegment({ key: 'b', reducer: counter, deps });

    deps.pop();

    expect(Object.isFrozen(segment)).toBe(true);
    expect(Object.isFrozen(segment.deps)).toBe(true);
    expect(segment.deps).toHaveLength(1);
  });

  it('records the key as a segment key', () => {
    expect(isSegmentKey('recorded')).toBe(false);

    defineSegment({ key: 'recorded', reducer: counter });

    expect(isSegmentKey('recorded')).toBe(true);
  });

  it('defines a segment without a reducer, which owns no slice', () => {
    const epic = () => undefined;
    const poller = defineSegment({ key: 'reducerless', epics: [epic] });
    const bundle = defineSegment({ key: 'bundle', deps: [poller] });

    expect(poller.reducer).toBeUndefined();
    expect(poller.epics).toEqual([epic]);
    expect(bundle.deps).toEqual([poller]);
    expect(isSegmentKey('reducerless')).toBe(false);
    expect(isSegmentKey('bundle')).toBe(false);
  });

  it('rejects invalid options', () => {
    expect(() => defineSegment({ key: '', reducer: counter })).toThrow(TypeError);
    expect(() => defineSegment({ key: 'x', reducer: 1 as never })).toThrow(TypeError);
    expect(() => defineSegment({ key: 'x', reducer: counter, idleTimeout: -1 })).toThrow(
      RangeError,
    );
  });
});
