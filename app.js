// app.js
// ES Module that wires the UI to data loading, model training, evaluation, and visualization.

import { parseCSVFile, prepareTensors } from "./data-loader.js";
import { setBackend, createModel, trainModel, evaluateModel, predictText, saveModel, loadModel, disposeModel } from "./rnn.js";
import { YandexMapsScraper } from "./yandex-scraper.js";

// DOM refs
const els = {
  csvFile: document.getElementById("csvFile"),
  btnLoad: document.getElementById("btnLoad"),
  dataInfo: document.getElementById("dataInfo"),
  removeStopwords: document.getElementById("removeStopwords"),
  seqLen: document.getElementById("seqLen"),
  maxVocab: document.getElementById("maxVocab"),
  backend: document.getElementById("backend"),
  btnSwitchBackend: document.getElementById("btnSwitchBackend"),

  epochs: document.getElementById("epochs"),
  batchSize: document.getElementById("batchSize"),
  valSplit: document.getElementById("valSplit"),
  btnTrain: document.getElementById("btnTrain"),
  trainStatus: document.getElementById("trainStatus"),
  trainingChart: document.getElementById("trainingChart"),

  btnEvaluate: document.getElementById("btnEvaluate"),
  evalCounts: document.getElementById("evalCounts"),
  kpiAcc: document.getElementById("kpiAcc"),
  kpiPrec: document.getElementById("kpiPrec"),
  kpiRec: document.getElementById("kpiRec"),
  kpiF1: document.getElementById("kpiF1"),
  metricsChart: document.getElementById("metricsChart"),

  cmTN: document.getElementById("cmTN"),
  cmTP: document.getElementById("cmTP"),
  cmFP: document.getElementById("cmFP"),
  cmFN: document.getElementById("cmFN"),

  samplesTableBody: document.querySelector("#samplesTable tbody"),

  freeText: document.getElementById("freeText"),
  btnPredict: document.getElementById("btnPredict"),
  freePred: document.getElementById("freePred"),
  freeProb: document.getElementById("freeProb"),

  btnSave: document.getElementById("btnSave"),
  modelFile: document.getElementById("modelFile"),
  btnLoadModel: document.getElementById("btnLoadModel"),

  // Yandex Maps elements
  yandexUrl: document.getElementById("yandexUrl"),
  btnAnalyzeYandex: document.getElementById("btnAnalyzeYandex"),
  yandexResults: document.getElementById("yandexResults"),
  placeInfo: document.getElementById("placeInfo"),
  recommendationCard: document.getElementById("recommendationCard"),
  commentsTable: document.getElementById("commentsTable"),
};

let dataset = {
  X_train: null,
  y_train: null,
  X_test: null,
  y_test: null,
  tokenizerMeta: null,
  tokenizer: null,
  counts: null
};

let charts = {
  training: null,
  metrics: null,
};

// Yandex Maps scraper instance
let yandexScraper = new YandexMapsScraper();

function fmtPct(x) {
  if (!isFinite(x)) return "—";
  return (x * 100).toFixed(2) + "%";
}
function fmtNum(n) { return new Intl.NumberFormat().format(n); }

function destroyCharts() {
  try { charts.training?.destroy(); } catch {}
  try { charts.metrics?.destroy(); } catch {}
  charts.training = null; charts.metrics = null;
}

async function switchBackend() {
  const name = els.backend.value;
  els.trainStatus.textContent = `Switching backend to ${name}...`;
  try {
    const active = await setBackend(name);
    els.trainStatus.textContent = `Active backend: ${active}`;
  } catch (err) {
    els.trainStatus.textContent = `Backend switch failed: ${err.message}`;
  }
}

// Initialize backend default
switchBackend();

// Load CSV
els.btnLoad.addEventListener("click", async () => {
  const file = els.csvFile.files?.[0];
  if (!file) {
    alert("Please choose a CSV file first.");
    return;
  }
  try {
    els.dataInfo.textContent = "Parsing CSV...";
    const { texts, labels } = await parseCSVFile(file);
    if (!texts.length) {
      els.dataInfo.textContent = "No valid rows found.";
      return;
    }
    const seqLen = parseInt(els.seqLen.value, 10);
    const maxVocab = parseInt(els.maxVocab.value, 10);
    const removeStopwords = els.removeStopwords.checked;

    // Dispose old tensors if present
    dataset.X_train?.dispose?.(); dataset.y_train?.dispose?.();
    dataset.X_test?.dispose?.(); dataset.y_test?.dispose?.();

    const prep = await prepareTensors({
      texts, labels, seqLen, maxVocab, removeStopwords, testSplit: 0.2
    });

    Object.assign(dataset, prep);

    els.dataInfo.innerHTML = `
      Parsed <b>${fmtNum(prep.counts.N)}</b> samples.
      Train: <b>${fmtNum(prep.counts.nTrain)}</b>,
      Test: <b>${fmtNum(prep.counts.nTest)}</b>.
      Vocab: <b>${fmtNum(prep.tokenizerMeta.vocabSize)}</b>. SeqLen: <b>${seqLen}</b>.
    `;
    els.evalCounts.textContent = `Test N=${fmtNum(prep.counts.nTest)}`;
  } catch (err) {
    console.error(err);
    els.dataInfo.textContent = "Error parsing CSV: " + err.message;
  }
});

els.btnSwitchBackend.addEventListener("click", switchBackend);

// Train
els.btnTrain.addEventListener("click", async () => {
  if (!dataset.X_train || !dataset.y_train) {
    alert("Load and preprocess data first.");
    return;
  }
  destroyCharts();

  const epochs = parseInt(els.epochs.value, 10);
  const batchSize = parseInt(els.batchSize.value, 10);
  const validationSplit = parseFloat(els.valSplit.value);

  els.trainStatus.textContent = "Creating model...";
  disposeModel();

  const model = createModel({
    vocabSize: dataset.tokenizerMeta.vocabSize,
    seqLen: dataset.tokenizerMeta.seqLen,
    embedDim: 64,
    gruUnits: 128,
    dropout: 0.2,
    bidirectional: true,
  });

  // Setup training chart
  charts.training = new Chart(els.trainingChart.getContext("2d"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Loss", data: [], yAxisID: "y1", tension: 0.25 },
        { label: "Val Loss", data: [], yAxisID: "y1", tension: 0.25 },
        { label: "Accuracy", data: [], yAxisID: "y2", tension: 0.25 },
        { label: "Val Accuracy", data: [], yAxisID: "y2", tension: 0.25 },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y1: { type: "linear", position: "left", title: { display: true, text: "Loss" } },
        y2: { type: "linear", position: "right", title: { display: true, text: "Accuracy" }, min: 0, max: 1, grid: { drawOnChartArea: false } },
      },
      plugins: { legend: { position: "bottom" } }
    }
  });

  const onEpochEnd = (epoch, logs) => {
    charts.training.data.labels.push(`E${epoch + 1}`);
    charts.training.data.datasets[0].data.push(logs.loss ?? null);
    charts.training.data.datasets[1].data.push(logs.val_loss ?? null);
    charts.training.data.datasets[2].data.push(logs.acc ?? logs.accuracy ?? null);
    charts.training.data.datasets[3].data.push(logs.val_acc ?? logs.val_accuracy ?? null);
    charts.training.update();
    els.trainStatus.textContent = `Epoch ${epoch + 1}/${epochs} — loss=${(logs.loss||0).toFixed(4)} acc=${((logs.acc ?? logs.accuracy)||0).toFixed(4)}`;
  };

  try {
    els.trainStatus.textContent = "Training...";
    await trainModel({
      X_train: dataset.X_train,
      y_train: dataset.y_train,
      epochs,
      batchSize,
      validationSplit,
      onEpochEnd,
    });
    els.trainStatus.textContent = "Training complete ✅";
  } catch (err) {
    console.error(err);
    els.trainStatus.textContent = "Training failed: " + err.message;
  }
});

// Evaluate
els.btnEvaluate.addEventListener("click", async () => {
  if (!dataset.X_test || !dataset.y_test) {
    alert("No test set available. Load data first.");
    return;
  }
  try {
    const res = await evaluateModel({ X_test: dataset.X_test, y_test: dataset.y_test, threshold: 0.5 });

    // KPIs
    els.kpiAcc.textContent = fmtPct(res.accuracy);
    els.kpiPrec.textContent = fmtPct(res.precision);
    els.kpiRec.textContent = fmtPct(res.recall);
    els.kpiF1.textContent = fmtPct(res.f1);

    // Confusion matrix
    els.cmTP.textContent = fmtNum(res.cm.tp);
    els.cmTN.textContent = fmtNum(res.cm.tn);
    els.cmFP.textContent = fmtNum(res.cm.fp);
    els.cmFN.textContent = fmtNum(res.cm.fn);

    // Metrics bar chart
    charts.metrics?.destroy?.();
    charts.metrics = new Chart(els.metricsChart.getContext("2d"), {
      type: "bar",
      data: {
        labels: ["Accuracy", "Precision", "Recall", "F1"],
        datasets: [{ label: "Score", data: [res.accuracy, res.precision, res.recall, res.f1] }]
      },
      options: {
        responsive: true,
        scales: { y: { min: 0, max: 1 } },
        plugins: { legend: { display: false } }
      }
    });

    // Per-sample results
    renderSamples(dataset, res);

  } catch (err) {
    console.error(err);
    alert("Evaluation failed: " + err.message);
  }
});

function truncate(text, n = 120) {
  if (!text) return "";
  text = text.replace(/\s+/g, " ");
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

function renderSamples(dataset, res) {
  // We need original texts for the test set rows. We can reconstruct indexes given we split in prepareTensors.
  // As a pragmatic UI, show up to 400 samples with synthetic content markers (no original text kept to save memory).
  // If original texts are needed, handle within data-loader to keep them; for now mark rows numerically.

  const tbody = els.samplesTableBody;
  tbody.innerHTML = "";
  const N = res.yTrue.length;
  const show = Math.min(N, 400);

  for (let i = 0; i < show; i++) {
    const correct = res.yTrue[i] === res.yPred[i];
    const tr = document.createElement("tr");
    tr.className = correct ? "correct" : "incorrect";
    const num = document.createElement("td"); num.textContent = String(i + 1);
    const textTd = document.createElement("td");
    // We cannot recover the original review text here without storing it; display token stats instead.
    textTd.innerHTML = `<span class="muted">#${i + 1}</span> (sequence length ${dataset.tokenizerMeta.seqLen})`;
    const yTrue = document.createElement("td"); yTrue.textContent = res.yTrue[i];
    const yPred = document.createElement("td"); yPred.innerHTML = res.yPred[i] === res.yTrue[i] ? `<span class="good">${res.yPred[i]}</span>` : `<span class="bad">${res.yPred[i]}</span>`;
    const prob = document.createElement("td"); prob.textContent = (res.yProb[i]).toFixed(4);
    tr.appendChild(num); tr.appendChild(textTd); tr.appendChild(yTrue); tr.appendChild(yPred); tr.appendChild(prob);
    tbody.appendChild(tr);
  }
}

// Free-text prediction
els.btnPredict.addEventListener("click", () => {
  const text = els.freeText.value?.trim();
  if (!text) {
    alert("Type some text first.");
    return;
  }
  if (!dataset.tokenizer || !dataset.tokenizerMeta) {
    alert("Load data and train or load a model first (tokenizer needed).");
    return;
  }
  try {
    const { prob, pred } = predictText({ text, tokenizer: dataset.tokenizer, tokenizerMeta: dataset.tokenizerMeta, threshold: 0.5 });
    els.freePred.textContent = pred === 1 ? "Positive (1)" : "Negative (0)";
    els.freePred.style.color = pred === 1 ? "var(--good)" : "var(--bad)";
    els.freeProb.textContent = prob.toFixed(4);
  } catch (err) {
    alert("Prediction failed: " + err.message);
  }
});

// Save / Load model
els.btnSave.addEventListener("click", async () => {
  if (!dataset.tokenizerMeta) {
    alert("No trained model available to save. Please train a model first.");
    return;
  }
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sentiment-model-${timestamp}.json`;
    await saveModel(dataset.tokenizerMeta, filename);
    alert(`Model saved as ${filename}`);
  } catch (err) {
    alert("Save failed: " + err.message);
  }
});

els.btnLoadModel.addEventListener("click", async () => {
  const file = els.modelFile.files?.[0];
  if (!file) {
    alert("Please select a model file first.");
    return;
  }
  try {
    els.trainStatus.textContent = "Loading model...";
    const result = await loadModel(file);
    
    // Update dataset with loaded tokenizer metadata
    dataset.tokenizerMeta = result.tokenizerMeta;
    
    // Create a tokenizer instance from the metadata
    dataset.tokenizer = {
      wordIndex: result.tokenizerMeta.wordIndex,
      indexWord: result.tokenizerMeta.indexWord,
      vocabSize: result.tokenizerMeta.vocabSize,
      removeStopwords: result.tokenizerMeta.removeStopwords,
      textsToSequences: function(texts) {
        return texts.map(t => {
          const norm = this._normalize(t);
          if (!norm) return [];
          return norm.split(" ").map(w => this.wordIndex[w] ?? 1);
        });
      },
      padSequences: function(sequences, seqLen = result.tokenizerMeta.seqLen) {
        const out = new Array(sequences.length);
        for (let i = 0; i < sequences.length; i++) {
          const s = sequences[i];
          if (s.length >= seqLen) {
            out[i] = s.slice(0, seqLen);
          } else {
            const pad = new Array(seqLen - s.length).fill(0);
            out[i] = s.concat(pad);
          }
        }
        return out;
      },
      _normalize: function(text) {
        if (!text || typeof text !== "string") return "";
        const lowered = text.toLowerCase();
        const stripped = lowered.replace(/[^a-z0-9'\s]+/g, " ").replace(/\s+/g, " ").trim();
        if (!this.removeStopwords) return stripped;
        const stopwords = new Set([
          "a","an","the","and","or","if","in","on","for","to","from",
          "is","are","was","were","be","been","being","of","with","it",
          "this","that","these","those","at","by","as","but","what","which",
          "who","whom","into","out","up","down","over","under","again","further",
          "then","once","here","there","when","where","why","how","all","any",
          "both","each","few","more","most","other","some","such","no","nor",
          "not","only","own","same","so","than","too","very","can","will","just",
          "don","should","now","i","me","my","myself","we","our","ours","ourselves",
          "you","your","yours","yourself","yourselves","he","him","his","himself",
          "she","her","hers","herself","itself","they","them","their","theirs",
          "themselves","do","did","does","doing","have","has","had","having"
        ]);
        return stripped.split(" ").filter(w => w && !stopwords.has(w)).join(" ");
      }
    };
    
    els.trainStatus.textContent = `Model loaded successfully! Vocab: ${result.tokenizerMeta.vocabSize}, SeqLen: ${result.tokenizerMeta.seqLen}`;
    alert("Model loaded successfully! You can now make predictions.");
  } catch (err) {
    console.error(err);
    els.trainStatus.textContent = "Load failed: " + err.message;
    alert("Load failed: " + err.message);
  }
});

// Yandex Maps Analysis
els.btnAnalyzeYandex.addEventListener("click", async () => {
  const url = els.yandexUrl.value?.trim();
  if (!url) {
    alert("Please enter a Yandex Maps URL first.");
    return;
  }
  
  if (!dataset.tokenizer || !dataset.tokenizerMeta) {
    alert("Please load data and train or load a model first (tokenizer needed for sentiment analysis).");
    return;
  }

  try {
    els.yandexResults.style.display = "block";
    els.yandexResults.innerHTML = "<div class='muted'>Analyzing Yandex Maps place...</div>";
    
    // Create sentiment analyzer object
    const sentimentAnalyzer = {
      predictText: ({ text, threshold = 0.5 }) => {
        return predictText({ 
          text, 
          tokenizer: dataset.tokenizer, 
          tokenizerMeta: dataset.tokenizerMeta, 
          threshold 
        });
      }
    };
    
    // Analyze the place
    const result = await yandexScraper.analyzePlace(url, sentimentAnalyzer);
    
    // Display results
    displayYandexResults(result);
    
  } catch (error) {
    console.error("Yandex analysis error:", error);
    els.yandexResults.innerHTML = `<div class="bad">Error analyzing place: ${error.message}</div>`;
  }
});

function displayYandexResults(result) {
  const { placeInfo, recommendation, comments } = result;
  
  console.log('Displaying results:', result);
  
  // Display place information
  if (els.placeInfo) {
    els.placeInfo.innerHTML = `
      <h4>📍 Place Information</h4>
      <div class="muted">
        <div>Coordinates: ${placeInfo.coordinates.lat.toFixed(6)}, ${placeInfo.coordinates.lng.toFixed(6)}</div>
        <div>Place ID: ${placeInfo.placeId}</div>
        <div>Total Comments: ${comments.length}</div>
      </div>
    `;
  }
  
  // Display recommendation
  const recClass = recommendation.recommendation === 'highly_recommended' ? 'good' : 
                   recommendation.recommendation === 'strongly_not_recommended' ? 'bad' : 'warn';
  
  if (els.recommendationCard) {
    els.recommendationCard.innerHTML = `
      <h4>🎯 Final Recommendation</h4>
      <div class="${recClass}" style="font-size: 24px; font-weight: bold; margin: 10px 0;">
        ${recommendation.recommendationText}
      </div>
      <div class="kpi">
        <div class="card">
          <div class="muted">Positive</div>
          <div class="good" style="font-size: 20px;">${recommendation.stats.positiveComments}</div>
          <div class="muted">${recommendation.stats.positivePercentage}%</div>
        </div>
        <div class="card">
          <div class="muted">Negative</div>
          <div class="bad" style="font-size: 20px;">${recommendation.stats.negativeComments}</div>
          <div class="muted">${recommendation.stats.negativePercentage}%</div>
        </div>
        <div class="card">
          <div class="muted">Total</div>
          <div style="font-size: 20px;">${recommendation.stats.totalComments}</div>
        </div>
      </div>
    `;
  }
  
  // Display comments table
  if (els.commentsTable) {
    const tbody = els.commentsTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '';
      
      comments.forEach((comment, index) => {
        const tr = document.createElement('tr');
        const sentimentClass = comment.sentiment === 'positive' ? 'good' : 'bad';
        
        tr.innerHTML = `
          <td>${index + 1}</td>
          <td>
            <div style="max-width: 300px; word-wrap: break-word;">
              <strong>Original:</strong> ${comment.originalText}<br>
              <strong>Translated:</strong> ${comment.translatedText}
            </div>
          </td>
          <td>${comment.rating}/5</td>
          <td class="${sentimentClass}">${comment.sentiment}</td>
          <td>${comment.confidence.toFixed(3)}</td>
          <td>${comment.language}</td>
          <td>${comment.author}</td>
        `;
        
        tbody.appendChild(tr);
      });
    }
  }
  
  // Show the results section
  if (els.yandexResults) {
    els.yandexResults.style.display = "block";
    els.yandexResults.innerHTML = `
      <div class="grid grid-cols-2" style="margin-bottom: 16px;">
        <div id="placeInfo" class="card"></div>
        <div id="recommendationCard" class="card"></div>
      </div>
      
      <div class="card">
        <h4>📝 Comments Analysis</h4>
        <div class="scroll">
          <table id="commentsTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Comment</th>
                <th>Rating</th>
                <th>Sentiment</th>
                <th>Confidence</th>
                <th>Language</th>
                <th>Author</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;
    
    // Re-query the elements after creating them
    const placeInfoEl = document.getElementById("placeInfo");
    const recommendationCardEl = document.getElementById("recommendationCard");
    const commentsTableEl = document.getElementById("commentsTable");
    
    if (placeInfoEl) {
      placeInfoEl.innerHTML = `
        <h4>📍 Place Information</h4>
        <div class="muted">
          <div>Coordinates: ${placeInfo.coordinates.lat.toFixed(6)}, ${placeInfo.coordinates.lng.toFixed(6)}</div>
          <div>Place ID: ${placeInfo.placeId}</div>
          <div>Total Comments: ${comments.length}</div>
        </div>
      `;
    }
    
    if (recommendationCardEl) {
      recommendationCardEl.innerHTML = `
        <h4>🎯 Final Recommendation</h4>
        <div class="${recClass}" style="font-size: 24px; font-weight: bold; margin: 10px 0;">
          ${recommendation.recommendationText}
        </div>
        <div class="kpi">
          <div class="card">
            <div class="muted">Positive</div>
            <div class="good" style="font-size: 20px;">${recommendation.stats.positiveComments}</div>
            <div class="muted">${recommendation.stats.positivePercentage}%</div>
          </div>
          <div class="card">
            <div class="muted">Negative</div>
            <div class="bad" style="font-size: 20px;">${recommendation.stats.negativeComments}</div>
            <div class="muted">${recommendation.stats.negativePercentage}%</div>
          </div>
          <div class="card">
            <div class="muted">Total</div>
            <div style="font-size: 20px;">${recommendation.stats.totalComments}</div>
          </div>
        </div>
      `;
    }
    
    if (commentsTableEl) {
      const tbody = commentsTableEl.querySelector('tbody');
      if (tbody) {
        tbody.innerHTML = '';
        
        comments.forEach((comment, index) => {
          const tr = document.createElement('tr');
          const sentimentClass = comment.sentiment === 'positive' ? 'good' : 'bad';
          
          tr.innerHTML = `
            <td>${index + 1}</td>
            <td>
              <div style="max-width: 300px; word-wrap: break-word;">
                <strong>Original:</strong> ${comment.originalText}<br>
                <strong>Translated:</strong> ${comment.translatedText}
              </div>
            </td>
            <td>${comment.rating}/5</td>
            <td class="${sentimentClass}">${comment.sentiment}</td>
            <td>${comment.confidence.toFixed(3)}</td>
            <td>${comment.language}</td>
            <td>${comment.author}</td>
          `;
          
          tbody.appendChild(tr);
        });
      }
    }
  }
}

// Clean up when navigating away
window.addEventListener("beforeunload", () => {
  try {
    dataset.X_train?.dispose?.();
    dataset.y_train?.dispose?.();
    dataset.X_test?.dispose?.();
    dataset.y_test?.dispose?.();
  } catch {}
});

// Optional: drag-and-drop file support
document.addEventListener("dragover", (e) => { e.preventDefault(); });
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    els.csvFile.files = e.dataTransfer.files;
  }
});
