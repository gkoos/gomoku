/* @ts-self-types="./gomoku_engine.d.ts" */

/**
 * Complete root selection followed, when necessary, by iterative search.
 */
export class MoveEngine {
    static __wrap(ptr) {
        const obj = Object.create(MoveEngine.prototype);
        obj.__wbg_ptr = ptr;
        MoveEngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MoveEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_moveengine_free(ptr, 0);
    }
    /**
     * @param {Uint32Array} black
     * @param {Uint32Array} white
     * @param {boolean} computer_black
     * @param {number} difficulty
     * @param {number} extension
     * @param {number} table_capacity
     */
    constructor(black, white, computer_black, difficulty, extension, table_capacity) {
        const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.moveengine_new(ptr0, len0, ptr1, len1, computer_black, difficulty, extension, table_capacity);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        MoveEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    next_depth() {
        const ret = wasm.moveengine_next_depth(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    root_move() {
        const ret = wasm.moveengine_root_move(this.__wbg_ptr);
        return ret;
    }
    /**
     * Factory keeps the existing constructor and browser defaults compatible.
     * @param {Uint32Array} black
     * @param {Uint32Array} white
     * @param {boolean} computer_black
     * @param {number} difficulty
     * @param {number} extension
     * @param {number} table_capacity
     * @param {Int32Array} weights
     * @returns {MoveEngine}
     */
    static with_weights(black, white, computer_black, difficulty, extension, table_capacity, weights) {
        const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(weights, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.moveengine_with_weights(ptr0, len0, ptr1, len1, computer_black, difficulty, extension, table_capacity, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MoveEngine.__wrap(ret[0]);
    }
}
if (Symbol.dispose) MoveEngine.prototype[Symbol.dispose] = MoveEngine.prototype.free;

export class PositionHasher {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PositionHasherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_positionhasher_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    black_to_move() {
        const ret = wasm.positionhasher_black_to_move(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Uint32Array} black
     * @param {Uint32Array} white
     * @param {boolean} black_to_move
     */
    constructor(black, white, black_to_move) {
        const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.positionhasher_new(ptr0, len0, ptr1, len1, black_to_move);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        PositionHasherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} position
     * @param {boolean} black
     */
    toggle_move(position, black) {
        const ret = wasm.positionhasher_toggle_move(this.__wbg_ptr, position, black);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {Uint32Array}
     */
    words() {
        const ret = wasm.positionhasher_words(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) PositionHasher.prototype[Symbol.dispose] = PositionHasher.prototype.free;

/**
 * One synchronous completed depth per call; no browser orchestration yet.
 */
export class SearchEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SearchEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_searchengine_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    black_to_move() {
        const ret = wasm.searchengine_black_to_move(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} depth
     * @param {boolean} maximizing
     * @param {number} alpha
     * @param {number} beta
     * @returns {Float64Array}
     */
    fixed_depth(depth, maximizing, alpha, beta) {
        const ret = wasm.searchengine_fixed_depth(this.__wbg_ptr, depth, maximizing, alpha, beta);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    hash_words() {
        const ret = wasm.searchengine_hash_words(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    history_length() {
        const ret = wasm.searchengine_history_length(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Uint32Array} black
     * @param {Uint32Array} white
     * @param {boolean} perspective_black
     * @param {number} max_depth
     * @param {number} extension
     * @param {number} table_capacity
     */
    constructor(black, white, perspective_black, max_depth, extension, table_capacity) {
        const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.searchengine_new(ptr0, len0, ptr1, len1, perspective_black, max_depth, extension, table_capacity);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        SearchEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    next_depth() {
        const ret = wasm.searchengine_next_depth(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {boolean} black
     * @returns {Uint32Array}
     */
    occupancy(black) {
        const ret = wasm.searchengine_occupancy(this.__wbg_ptr, black);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) SearchEngine.prototype[Symbol.dispose] = SearchEngine.prototype.free;

/**
 * Stateful prototype interface. Array getters return copies, not mutable internal views.
 */
export class SearchState {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SearchStateFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_searchstate_free(ptr, 0);
    }
    /**
     * @param {number} position
     * @param {number} direction
     * @param {boolean} black
     * @returns {number}
     */
    analyze_pattern(position, direction, black) {
        const ret = wasm.searchstate_analyze_pattern(this.__wbg_ptr, position, direction, black);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {boolean} player_black
     * @returns {Int32Array}
     */
    candidates(player_black) {
        const ret = wasm.searchstate_candidates(this.__wbg_ptr, player_black);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {boolean} black
     * @returns {boolean}
     */
    has_immediate_threat(black) {
        const ret = wasm.searchstate_has_immediate_threat(this.__wbg_ptr, black);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    history_length() {
        const ret = wasm.searchstate_history_length(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {boolean} black
     * @returns {Uint16Array}
     */
    line_masks(black) {
        const ret = wasm.searchstate_line_masks(this.__wbg_ptr, black);
        var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
    /**
     * @param {number} position
     * @param {boolean} black
     * @returns {number}
     */
    make_move(position, black) {
        const ret = wasm.searchstate_make_move(this.__wbg_ptr, position, black);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {Uint32Array} black
     * @param {Uint32Array} white
     * @param {boolean} perspective_black
     */
    constructor(black, white, perspective_black) {
        const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.searchstate_new(ptr0, len0, ptr1, len1, perspective_black);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        SearchStateFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {boolean} black
     * @returns {Uint32Array}
     */
    occupancy(black) {
        const ret = wasm.searchstate_occupancy(this.__wbg_ptr, black);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    score() {
        const ret = wasm.searchstate_score(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} token
     */
    undo_move(token) {
        const ret = wasm.searchstate_undo_move(this.__wbg_ptr, token);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} black
     * @returns {Uint8Array}
     */
    winning_references(black) {
        const ret = wasm.searchstate_winning_references(this.__wbg_ptr, black);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {boolean} black
     * @returns {Uint32Array}
     */
    winning_squares(black) {
        const ret = wasm.searchstate_winning_squares(this.__wbg_ptr, black);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) SearchState.prototype[Symbol.dispose] = SearchState.prototype.free;

/**
 * @param {Uint32Array} own
 * @param {Uint32Array} opponent
 * @param {number} position
 * @param {number} direction
 * @returns {number}
 */
export function analyze_pattern(own, opponent, position, direction) {
    const ptr0 = passArray32ToWasm0(own, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(opponent, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.analyze_pattern(ptr0, len0, ptr1, len1, position, direction);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @returns {boolean}
 */
export function boards_full(black, white) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.boards_full(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @returns {boolean}
 */
export function boards_overlap(black, white) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.boards_overlap(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * Packed result: stones, windows and winning moves in successive bytes;
 * open-three and open-two flags occupy bits 24 and 25.
 * @param {number} friendly
 * @param {number} blockers
 * @returns {number}
 */
export function classify_pattern(friendly, blockers) {
    const ret = wasm.classify_pattern(friendly, blockers);
    return ret >>> 0;
}

/**
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @returns {Uint32Array}
 */
export function empty_positions(black, white) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.empty_positions(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @param {boolean} perspective_black
 * @returns {number}
 */
export function evaluate_position(black, white, perspective_black) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.evaluate_position(ptr0, len0, ptr1, len1, perspective_black);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * Triples of position, priority, tactical classification (-1 for opening moves).
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @param {boolean} player_black
 * @returns {Int32Array}
 */
export function generate_candidates(black, white, player_black) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.generate_candidates(ptr0, len0, ptr1, len1, player_black);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @returns {Uint32Array}
 */
export function occupied_positions(black, white) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.occupied_positions(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @param {number} position
 * @param {boolean} computer_black
 * @param {number} priority
 * @returns {number}
 */
export function score_root_move(black, white, position, computer_black, priority) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.score_root_move(ptr0, len0, ptr1, len1, position, computer_black, priority);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * Diagnostic root-only selection: -2 requires search, -1 is terminal.
 * @param {Uint32Array} black
 * @param {Uint32Array} white
 * @param {boolean} computer_black
 * @param {boolean} easy
 * @returns {number}
 */
export function select_root(black, white, computer_black, easy) {
    const ptr0 = passArray32ToWasm0(black, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(white, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.select_root(ptr0, len0, ptr1, len1, computer_black, easy);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./gomoku_engine_bg.js": import0,
    };
}

const MoveEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_moveengine_free(ptr, 1));
const PositionHasherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_positionhasher_free(ptr, 1));
const SearchEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_searchengine_free(ptr, 1));
const SearchStateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_searchstate_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('gomoku_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
