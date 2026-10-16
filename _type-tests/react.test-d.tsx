import { expectTypeOf } from 'expect-type';
import type { ReactNode } from 'react';
import { defineSegment } from '../src';
import { createSparseReact, SparseScope, useSparseSegments } from '../src/react';

const orders = defineSegment({ key: 'orders', reducer: (state: number = 0) => state });

expectTypeOf(useSparseSegments)
  .parameter(0)
  .toEqualTypeOf<readonly import('../src').AnySegment[]>();
expectTypeOf(useSparseSegments([orders])).toEqualTypeOf<boolean>();

const scope: ReactNode = (
  <SparseScope segments={[orders]} fallback={<span>loading</span>}>
    <span>loaded</span>
  </SparseScope>
);

// @ts-expect-error `segments` is required
const missing: ReactNode = <SparseScope />;

const custom = createSparseReact();
const customScope: ReactNode = <custom.SparseScope segments={[orders]} />;
