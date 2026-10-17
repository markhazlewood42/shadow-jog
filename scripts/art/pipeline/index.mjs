// The art pipeline, one import for the tests and the tools. Stages: decompose (A), masks (B), classify (C), walk, region (6a).
export * from './decompose.mjs';
export * from './masks.mjs';
export * from './classify.mjs';
export * from './walk.mjs';
export * from './region.mjs';
export { GIVEN_FRAME, OUT_DIR, TARGET_JSON, loadGiven, loadIdleFrames, loadWalkFrames, readTarget } from './given.mjs';
