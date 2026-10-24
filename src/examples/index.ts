import { ex01, ex02, ex03, ex04, ex05, ex06, ex07, ex08, ex09, ex10, ex11 } from './basic';
import { ex12, ex13, ex14, ex15, ex16, ex17, ex18, ex19, ex20 } from './advanced';
import type { Example } from './types';
import type { ProjectDoc } from '../engine/types';
import { arrangeCircuit } from '../engine/layout';

export const EXAMPLES: Example[] = [ex01, ex02, ex03, ex04, ex05, ex06, ex07, ex08, ex09, ex10, ex11, ex12, ex13, ex14, ex15, ex16, ex17, ex18, ex19, ex20];

// Every example opens with its default layout (Auto Arrange; the hand-picked wire
// colours are kept). Patched on the objects so the examples' own checks, which call
// exNN.build(), load exactly what the user sees.
for (const ex of EXAMPLES) {
  const original = ex.build;
  let cached: ProjectDoc | null = null;
  ex.build = function () {
    cached ??= arrangeCircuit(original.call(this));
    return structuredClone(cached);
  };
}

export function exampleById(id: string) {
  return EXAMPLES.find((e) => e.id === id);
}

export type { Example } from './types';
