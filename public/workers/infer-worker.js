/* global ort */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js');

// 显式指定 WASM 后端资源文件的 CDN 加载路径，确保与 ort.min.js 版本严格一致且免于本地拷贝
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

let session = null;
let frameStack = [];
const ACTION_COUNT = 4;

async function ensureSession() {
  if (!session) {
    session = await ort.InferenceSession.create('/models/weights.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
}

function sampleGray(imageBitmap, cellSize = 40) {
  const offcanvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = offcanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, offcanvas.width, offcanvas.height);
  const data = imageData.data;

  const gridWidth = Math.floor(offcanvas.width / cellSize);
  const gridHeight = Math.floor(offcanvas.height / cellSize);
  const sampledGray = new Float32Array(gridWidth * gridHeight);

  let index = 0;
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const px = x * cellSize + cellSize / 2;
      const py = y * cellSize + cellSize / 2;
      const idx = (py * offcanvas.width + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      if (g > 30 && r < 100) sampledGray[index++] = g / 255.0;
      else if (r > 200 && g < 100) sampledGray[index++] = 1.0;
      else sampledGray[index++] = 0.0;
    }
  }
  return sampledGray;
}

function pickAction(qValues) {
  let max = -Infinity;
  let act = 0;
  for (let i = 0; i < ACTION_COUNT; i++) {
    if (qValues[i] > max) {
      max = qValues[i];
      act = i;
    }
  }
  return act;
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'reset') {
    frameStack = [];
    self.postMessage({ type: 'reset_done' });
    return;
  }

  if (type !== 'infer') return;

  try {
    const isFirstLoad = !session;
    await ensureSession();
    if (isFirstLoad) {
      self.postMessage({ type: 'model_loaded' });
    }
    const { imageBitmap, features } = e.data;
    const frame = sampleGray(imageBitmap);

    frameStack.push(frame);
    if (frameStack.length > 4) frameStack.shift();
    while (frameStack.length < 4) frameStack.unshift(frame);

    const state = new Float32Array(4 * 10 * 10);
    for (let c = 0; c < 4; c++) state.set(frameStack[c], c * 100);

    const stateTensor = new ort.Tensor('float32', state, [1, 4, 10, 10]);
    const featureTensor = new ort.Tensor('float32', new Float32Array(features), [1, 8]);

    const outputs = await session.run({ state: stateTensor, extra_features: featureTensor });
    const qValues = outputs.q_values.data;
    const action = pickAction(qValues);
    self.postMessage({ type: 'action', action });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
