declare module '@micropython/micropython-webassembly-pyscript/micropython.mjs' {
  export function loadMicroPython(opts?: { stdout?: (l: string) => void; stderr?: (l: string) => void; heapsize?: number; url?: string }): Promise<any>;
}
