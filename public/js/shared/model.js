/**
 * Model loading and inference utilities.
 */

import { softmax, cosineSimilarity } from './math.js';

export const LABELS = [
  'airplane', 'apple', 'banana', 'bicycle', 'bird', 'sailboat', 'car', 'cat',
  'clock', 'dog', 'fish', 'flower', 'guitar', 'hat', 'skull', 'house',
  'lightning', 'moon', 'pizza', 'shoe', 'smiley face', 'star', 'sun',
  'tree', 'umbrella'
];

let mainModel = null;
let featureModel = null;
let customCategories = {};

export function getCustomCategories() { return customCategories; }
export function setCustomCategories(cats) { customCategories = cats; }
export function getMainModel() { return mainModel; }
export function getFeatureModel() { return featureModel; }

/**
 * Load ONNX models. Call once on page init.
 * @param {object} options - { main: true, features: true }
 */
export async function loadModels({ main = true, features = false } = {}) {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

  const sessionOpts = { executionProviders: ['wasm'] };

  const fetches = [];
  if (main) fetches.push(fetch('/model/model.onnx').then(r => r.arrayBuffer()));
  if (features) fetches.push(fetch('/model/feature_extractor.onnx').then(r => r.arrayBuffer()));

  const buffers = await Promise.all(fetches);
  let idx = 0;

  if (main) {
    mainModel = await ort.InferenceSession.create(new Uint8Array(buffers[idx++]), sessionOpts);
  }
  if (features) {
    featureModel = await ort.InferenceSession.create(new Uint8Array(buffers[idx++]), sessionOpts);
  }

  return { mainModel, featureModel };
}

/**
 * User-friendly error message for model loading failures.
 */
export function getLoadErrorMessage(err) {
  const msg = err?.message || String(err);
  if (msg.includes('protobuf') || msg.includes('WASM') || msg.includes('SharedArrayBuffer')) {
    return `Your browser doesn't support the AI model.<br>
      Please use a modern browser (Chrome, Firefox, Edge, or Safari 16+).`;
  }
  if (msg.includes('fetch') || msg.includes('NetworkError') || msg.includes('404')) {
    return `Could not download the AI model.<br>Check your network connection.`;
  }
  return `Failed to load AI model.<br><span style="font-size:0.8rem;color:#888">${msg}</span>`;
}

/**
 * Run classification on a preprocessed tensor.
 * Returns sorted array of { label, prob }.
 */
export async function classify(tensor) {
  if (!mainModel) throw new Error('Main model not loaded');
  const output = await mainModel.run({ input: tensor });
  const logits = Array.from(output.output.data);
  const probs = softmax(logits);

  let results = LABELS.map((label, i) => ({ label, prob: probs[i] }));

  // Merge custom categories if feature model is available
  const customScores = await getCustomScores(tensor);
  results = results.concat(customScores);

  results.sort((a, b) => b.prob - a.prob);
  return results;
}

/**
 * Run raw classification (no custom categories). Returns softmax probabilities.
 */
export async function classifyRaw(inputArray) {
  const tensor = new ort.Tensor('float32', inputArray, [1, 1, 28, 28]);
  const output = await mainModel.run({ input: tensor });
  const logits = Array.from(output.output.data);
  return softmax(logits);
}

/**
 * Extract 128-dim feature vector from a tensor.
 */
export async function extractFeatures(tensor) {
  if (!featureModel) throw new Error('Feature model not loaded');
  const output = await featureModel.run({ input: tensor });
  return Array.from(output.features.data);
}

/**
 * Compute custom category scores using cosine similarity.
 */
export async function getCustomScores(tensor) {
  if (!featureModel || Object.keys(customCategories).length === 0) {
    return [];
  }
  const featOutput = await featureModel.run({ input: tensor });
  const features = Array.from(featOutput.features.data);

  const results = [];
  for (const [name, data] of Object.entries(customCategories)) {
    if (!data.samples || data.samples.length === 0) continue;
    const sims = data.samples.map(s => cosineSimilarity(features, s));
    const maxSim = Math.max(...sims);
    // Sigmoid mapping centered around 0.82
    const score = 1 / (1 + Math.exp(-20 * (maxSim - 0.82)));
    results.push({ label: name + ' *', prob: score, similarity: maxSim });
  }
  return results;
}

/**
 * Set up socket listener for custom categories.
 */
export function syncCustomCategories(socket) {
  socket.on('custom-categories', (cats) => { customCategories = cats; });
  socket.emit('get-custom-categories');
}
