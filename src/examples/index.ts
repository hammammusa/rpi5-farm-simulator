import { ex01, ex02, ex03, ex04, ex05, ex06, ex07, ex08, ex09, ex10, ex11 } from './basic';
import { ex12, ex13, ex14, ex15, ex16, ex17, ex18, ex19, ex20 } from './advanced';
import type { Example } from './types';

export const EXAMPLES: Example[] = [ex01, ex02, ex03, ex04, ex05, ex06, ex07, ex08, ex09, ex10, ex11, ex12, ex13, ex14, ex15, ex16, ex17, ex18, ex19, ex20];

export function exampleById(id: string) {
  return EXAMPLES.find((e) => e.id === id);
}

export type { Example } from './types';
