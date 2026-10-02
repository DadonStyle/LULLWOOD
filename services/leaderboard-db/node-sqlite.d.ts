// Minimal types for the parts of Node's built-in `node:sqlite` this service
// uses. The repo pins @types/node ^20, which predates the module; delete this
// file when @types/node is bumped to >=22.13 (which ships the real types).
declare module 'node:sqlite' {
  type SQLValue = null | number | bigint | string | Uint8Array;
  type Row = Record<string, SQLValue>;
  interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }
  export class StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Row | undefined;
    all(...params: unknown[]): Row[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; open?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
