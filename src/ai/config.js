export const WIN_SCORE = 1000000;
export const MAX_STATIC_SCORE = WIN_SCORE / 2;

export const TRANSPOSITION_TABLE_SIZE = 32768;

export const TACTICAL_EXTENSION_PLIES = 4;

export const ASPIRATION_DELTA = 1024;

// Candidate-ordering policy: a small GOMPOL1 model served from public/.
export const POLICY_MODEL_URL = '/models/policy-depth6.policy';
export const POLICY_SCALE = 1000;
export const POLICY_PLIES = 1;
