export const rendererDir: string;
export function bundleWorker(options?: { minify?: boolean }): Promise<string>;
export const renderer: { name: string; setup(build: unknown): void };
