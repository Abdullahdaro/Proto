// rnn.js
// ES Module that defines, trains, evaluates, and serves predictions for a GRU-based TF.js model.

let currentModel = null;
let currentBackend = null;

/** Switch TFJS backend ("webgl", "cpu", "wasm"). */
export async function setBackend(name = "webgl") {
  if (currentBackend === name) return;
  try {
    await tf.setBackend(name);
    await tf.ready();
    currentBackend = tf.getBackend();
    return currentBackend;
  } catch (err) {
    throw new Error(`Failed to set backend ${name}: ${err.message}`);
  }
}

/** Create a GRU model. */
export function createModel({ vocabSize, seqLen, embedDim = 64, gruUnits = 128, dropout = 0.2, bidirectional = false }) {
  if (!vocabSize || !seqLen) throw new Error("vocabSize and seqLen are required.");
  if (currentModel) {
    try { currentModel.dispose(); } catch {}
    currentModel = null;
  }

  const model = tf.sequential();
  model.add(tf.layers.embedding({
    inputDim: vocabSize,
    outputDim: embedDim,
    inputLength: seqLen,
    embeddingsInitializer: "glorotUniform",
  }));

  const gruLayer = tf.layers.gru({
    units: gruUnits,
    returnSequences: false,
    dropout,
    recurrentDropout: 0,
    kernelInitializer: "glorotUniform",
    recurrentInitializer: "glorotNormal", // avoids slow orthogonal init
  });

  if (bidirectional) {
    model.add(tf.layers.bidirectional({ layer: gruLayer, mergeMode: "concat" }));
  } else {
    model.add(gruLayer);
  }

  model.add(tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: "glorotUniform" }));

  model.compile({
    optimizer: tf.train.adam(),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"],
  });

  currentModel = model;
  return model;
}

/** Train model with callbacks to update UI (progress). */
export async function trainModel({
  X_train,
  y_train,
  epochs = 5,
  batchSize = 64,
  validationSplit = 0.1,
  onEpochEnd = () => {},
  onBatchEnd = () => {},
}) {
  if (!currentModel) throw new Error("Model not created. Call createModel first.");

  const callbacks = {
    onEpochEnd: async (epoch, logs) => {
      onEpochEnd(epoch, logs);
      await tf.nextFrame();
    },
    onBatchEnd: async (batch, logs) => {
      onBatchEnd(batch, logs);
    },
  };

  const history = await currentModel.fit(X_train, y_train, {
    epochs,
    batchSize,
    validationSplit,
    shuffle: true,
    callbacks,
  });

  return history;
}

/** Evaluate on test set; returns predictions and metrics. */
export async function evaluateModel({ X_test, y_test, threshold = 0.5 }) {
  if (!currentModel) throw new Error("Model not created or loaded.");
  const evalRes = currentModel.evaluate(X_test, y_test, { batchSize: 256 });
  const [lossTensor, accTensor] = Array.isArray(evalRes) ? evalRes : [evalRes];
  const [loss, accuracy] = await Promise.all([lossTensor.data(), accTensor.data()])
    .then(([l, a]) => [l[0], a ? a[0] : NaN]);

  const probs = await currentModel.predict(X_test, { batchSize: 256 }).data();
  const yTrue = Array.from(await y_test.data());
  const yProb = Array.from(probs);
  const yPred = yProb.map(p => (p >= threshold ? 1 : 0));

  // Confusion matrix
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (yTrue[i] === 1 && yPred[i] === 1) tp++;
    else if (yTrue[i] === 0 && yPred[i] === 0) tn++;
    else if (yTrue[i] === 0 && yPred[i] === 1) fp++;
    else if (yTrue[i] === 1 && yPred[i] === 0) fn++;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    loss,
    accuracy,
    yTrue,
    yPred,
    yProb,
    cm: { tp, tn, fp, fn },
    precision,
    recall,
    f1,
  };
}

/** Predict a single review string using tokenizer metadata. */
export function predictText({ text, tokenizerMeta, tokenizer, threshold = 0.5 }) {
  if (!currentModel) throw new Error("Model not created or loaded.");
  if (!text) return { prob: NaN, pred: null };

  const seq = tokenizer.textsToSequences([text]);
  const padded = tokenizer.padSequences(seq, tokenizerMeta.seqLen);
  const X = tf.tensor2d(padded, [1, tokenizerMeta.seqLen], "int32");
  const prob = currentModel.predict(X);
  const p = prob.dataSync()[0];
  X.dispose(); prob.dispose?.();
  return { prob: p, pred: p >= threshold ? 1 : 0 };
}

/** Save model as downloadable JSON file with tokenizer metadata. */
export async function saveModel(tokenizerMeta, filename = "sentiment-model.json") {
  if (!currentModel) throw new Error("No model to save.");
  if (!tokenizerMeta) throw new Error("Tokenizer metadata is required for saving.");
  
  try {
    // Create a custom save handler that captures the artifacts
    let capturedArtifacts = null;
    
    const customSaveHandler = {
      save: async (artifacts) => {
        capturedArtifacts = artifacts;
        return artifacts;
      }
    };
    
    // Save the model using our custom handler
    await currentModel.save(customSaveHandler);
    
    if (!capturedArtifacts) {
      throw new Error("Failed to capture model artifacts");
    }
    
    // Create downloadable JSON file with model and tokenizer data
    const modelData = {
      modelTopology: capturedArtifacts.modelTopology,
      weightSpecs: capturedArtifacts.weightSpecs,
      weightData: Array.from(new Uint8Array(capturedArtifacts.weightData)),
      format: capturedArtifacts.format || 'layers-model',
      generatedBy: capturedArtifacts.generatedBy || 'TensorFlow.js',
      convertedBy: capturedArtifacts.convertedBy || 'TensorFlow.js',
      savedAt: new Date().toISOString(),
      tokenizerMeta: tokenizerMeta
    };
    
    // Create and download the file
    const blob = new Blob([JSON.stringify(modelData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    return modelData;
  } catch (err) {
    throw new Error(`Failed to save model: ${err.message}`);
  }
}

/** Load model from uploaded JSON file and return both model and tokenizer metadata. */
export async function loadModel(file) {
  try {
    if (!file) {
      throw new Error("No file provided for loading.");
    }
    
    // Read the file content
    const text = await file.text();
    const modelData = JSON.parse(text);
    
    // Validate the model data structure
    if (!modelData.modelTopology || !modelData.weightSpecs || !modelData.weightData) {
      throw new Error("Invalid model file format.");
    }
    
    // Validate tokenizer metadata
    if (!modelData.tokenizerMeta) {
      throw new Error("Model file is missing tokenizer metadata. Please use a model saved with the updated save function.");
    }
    
    // Convert weightData back to ArrayBuffer
    const weightData = new Uint8Array(modelData.weightData).buffer;
    
    // Create model artifacts object
    const modelArtifacts = {
      modelTopology: modelData.modelTopology,
      weightSpecs: modelData.weightSpecs,
      weightData: weightData,
      format: modelData.format || 'layers-model',
      generatedBy: modelData.generatedBy,
      convertedBy: modelData.convertedBy
    };
    
    // Create a custom load handler
    const customLoadHandler = {
      load: async () => {
        return modelArtifacts;
      }
    };
    
    // Load the model using TensorFlow.js
    const m = await tf.loadLayersModel(customLoadHandler);
    
    currentModel = m;
    return { model: m, tokenizerMeta: modelData.tokenizerMeta };
  } catch (err) {
    throw new Error(`Failed to load model from file: ${err.message}`);
  }
}

/** Dispose the current model (free memory). */
export function disposeModel() {
  if (currentModel) {
    try { currentModel.dispose(); } catch {}
    currentModel = null;
  }
}
