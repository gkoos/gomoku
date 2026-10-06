/* tslint:disable */
/* eslint-disable */

/**
 * Complete root selection followed, when necessary, by iterative search.
 */
export class MoveEngine {
    free(): void;
    [Symbol.dispose](): void;
    constructor(black: Uint32Array, white: Uint32Array, computer_black: boolean, difficulty: number, extension: number, table_capacity: number);
    next_depth(): Float64Array;
    root_move(): number;
    static with_nnue(black: Uint32Array, white: Uint32Array, computer_black: boolean, difficulty: number, extension: number, table_capacity: number, model: Uint8Array, scale: number): MoveEngine;
    /**
     * Factory keeps the existing constructor and browser defaults compatible.
     */
    static with_weights(black: Uint32Array, white: Uint32Array, computer_black: boolean, difficulty: number, extension: number, table_capacity: number, weights: Int32Array): MoveEngine;
}

export class PositionHasher {
    free(): void;
    [Symbol.dispose](): void;
    black_to_move(): boolean;
    constructor(black: Uint32Array, white: Uint32Array, black_to_move: boolean);
    toggle_move(position: number, black: boolean): void;
    words(): Uint32Array;
}

/**
 * One synchronous completed depth per call; no browser orchestration yet.
 */
export class SearchEngine {
    free(): void;
    [Symbol.dispose](): void;
    black_to_move(): boolean;
    fixed_depth(depth: number, maximizing: boolean, alpha: number, beta: number): Float64Array;
    hash_words(): Uint32Array;
    history_length(): number;
    constructor(black: Uint32Array, white: Uint32Array, perspective_black: boolean, max_depth: number, extension: number, table_capacity: number);
    next_depth(): Float64Array;
    occupancy(black: boolean): Uint32Array;
    prefer_root(position: number): void;
}

/**
 * Stateful prototype interface. Array getters return copies, not mutable internal views.
 */
export class SearchState {
    free(): void;
    [Symbol.dispose](): void;
    analyze_pattern(position: number, direction: number, black: boolean): number;
    candidates(player_black: boolean): Int32Array;
    has_immediate_threat(black: boolean): boolean;
    history_length(): number;
    line_masks(black: boolean): Uint16Array;
    make_move(position: number, black: boolean): number;
    constructor(black: Uint32Array, white: Uint32Array, perspective_black: boolean);
    nnue_logit(black_to_move: boolean): number | undefined;
    occupancy(black: boolean): Uint32Array;
    score(): number;
    score_for_turn(black_to_move: boolean): number;
    set_nnue(model: Uint8Array, scale: number): void;
    undo_move(token: number): void;
    winning_references(black: boolean): Uint8Array;
    winning_squares(black: boolean): Uint32Array;
}

export function analyze_pattern(own: Uint32Array, opponent: Uint32Array, position: number, direction: number): number;

export function boards_full(black: Uint32Array, white: Uint32Array): boolean;

export function boards_overlap(black: Uint32Array, white: Uint32Array): boolean;

/**
 * Packed result: stones, windows and winning moves in successive bytes;
 * open-three and open-two flags occupy bits 24 and 25.
 */
export function classify_pattern(friendly: number, blockers: number): number;

export function empty_positions(black: Uint32Array, white: Uint32Array): Uint32Array;

export function evaluate_position(black: Uint32Array, white: Uint32Array, perspective_black: boolean): number;

/**
 * Triples of position, priority, tactical classification (-1 for opening moves).
 */
export function generate_candidates(black: Uint32Array, white: Uint32Array, player_black: boolean): Int32Array;

export function occupied_positions(black: Uint32Array, white: Uint32Array): Uint32Array;

export function score_root_move(black: Uint32Array, white: Uint32Array, position: number, computer_black: boolean, priority: number): number;

/**
 * Diagnostic root-only selection: -2 requires search, -1 is terminal.
 */
export function select_root(black: Uint32Array, white: Uint32Array, computer_black: boolean, easy: boolean): number;

/**
 * status (1 = proven win, 0 = unknown), nodes, budget exhausted, PV length, PV.
 */
export function solve_vcf(black: Uint32Array, white: Uint32Array, attacker_black: boolean, max_plies: number, node_budget: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_moveengine_free: (a: number, b: number) => void;
    readonly __wbg_positionhasher_free: (a: number, b: number) => void;
    readonly __wbg_searchengine_free: (a: number, b: number) => void;
    readonly __wbg_searchstate_free: (a: number, b: number) => void;
    readonly analyze_pattern: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly boards_full: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly boards_overlap: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly classify_pattern: (a: number, b: number) => number;
    readonly empty_positions: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly evaluate_position: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly generate_candidates: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly moveengine_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly moveengine_next_depth: (a: number) => [number, number, number, number];
    readonly moveengine_root_move: (a: number) => number;
    readonly moveengine_with_nnue: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly moveengine_with_weights: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly occupied_positions: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly positionhasher_black_to_move: (a: number) => number;
    readonly positionhasher_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly positionhasher_toggle_move: (a: number, b: number, c: number) => [number, number];
    readonly positionhasher_words: (a: number) => [number, number];
    readonly score_root_move: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly searchengine_black_to_move: (a: number) => number;
    readonly searchengine_fixed_depth: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly searchengine_hash_words: (a: number) => [number, number];
    readonly searchengine_history_length: (a: number) => number;
    readonly searchengine_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly searchengine_next_depth: (a: number) => [number, number, number, number];
    readonly searchengine_occupancy: (a: number, b: number) => [number, number];
    readonly searchengine_prefer_root: (a: number, b: number) => [number, number];
    readonly searchstate_analyze_pattern: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly searchstate_candidates: (a: number, b: number) => [number, number];
    readonly searchstate_has_immediate_threat: (a: number, b: number) => number;
    readonly searchstate_history_length: (a: number) => number;
    readonly searchstate_line_masks: (a: number, b: number) => [number, number];
    readonly searchstate_make_move: (a: number, b: number, c: number) => [number, number, number];
    readonly searchstate_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly searchstate_nnue_logit: (a: number, b: number) => number;
    readonly searchstate_occupancy: (a: number, b: number) => [number, number];
    readonly searchstate_score: (a: number) => number;
    readonly searchstate_score_for_turn: (a: number, b: number) => number;
    readonly searchstate_set_nnue: (a: number, b: number, c: number, d: number) => [number, number];
    readonly searchstate_undo_move: (a: number, b: number) => [number, number];
    readonly searchstate_winning_references: (a: number, b: number) => [number, number];
    readonly searchstate_winning_squares: (a: number, b: number) => [number, number];
    readonly select_root: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly solve_vcf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
