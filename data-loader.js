// data-loader.js
// ES Module for loading, cleaning, tokenizing, and tensorizing text sentiment data.
// Everything runs in-browser. No backend required.

export class Tokenizer {
    /**
     * Simple word-level tokenizer with:
     *  - lowercasing
     *  - punctuation stripping
     *  - optional stopword removal
     *  - OOV token id = 1, PAD id = 0
     */
    constructor({ numWords = 20000, removeStopwords = false } = {}) {
      this.numWords = numWords;
      this.removeStopwords = removeStopwords;
      this.wordIndex = { "<PAD>": 0, "<OOV>": 1 };
      this.indexWord = { 0: "<PAD>", 1: "<OOV>" };
      this._fitted = false;
      this._stop = new Set([
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
    }
  
    _normalize(text) {
      if (!text || typeof text !== "string") return "";
      const lowered = text.toLowerCase();
      // Replace punctuation with space; keep apostrophes inside words minimal effect
      const stripped = lowered.replace(/[^a-z0-9'\s]+/g, " ").replace(/\s+/g, " ").trim();
      if (!this.removeStopwords) return stripped;
      return stripped.split(" ").filter(w => w && !this._stop.has(w)).join(" ");
    }
  
    fitOnTexts(texts) {
      const freq = new Map();
      for (const t of texts) {
        const norm = this._normalize(t);
        if (!norm) continue;
        for (const w of norm.split(" ")) {
          if (!w) continue;
          freq.set(w, (freq.get(w) || 0) + 1);
        }
      }
      // Sort by frequency desc
      const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
      const limit = Math.max(0, this.numWords - 2); // reserve 0 and 1
      const top = sorted.slice(0, limit).map(([w]) => w);
  
      let idx = 2; // start from 2
      for (const w of top) {
        this.wordIndex[w] = idx;
        this.indexWord[idx] = w;
        idx++;
      }
      this.vocabSize = Object.keys(this.wordIndex).length;
      this._fitted = true;
    }
  
    textsToSequences(texts) {
      if (!this._fitted) throw new Error("Tokenizer not fitted. Call fitOnTexts first.");
      return texts.map(t => {
        const norm = this._normalize(t);
        if (!norm) return [];
        return norm.split(" ").map(w => this.wordIndex[w] ?? 1); // OOV=1
      });
    }
  
    padSequences(sequences, seqLen = 100) {
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
    }
  }
  
  /**
   * Parse CSV File object into arrays of texts and labels.
   * Expected columns: "review", "sentiment" (values "positive"/"negative")
   */
  export async function parseCSVFile(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        worker: true,
        complete: (res) => {
          try {
            const rows = res.data;
            const texts = [];
            const labels = [];
            for (const r of rows) {
              const review = r.review ?? r.Review ?? r.text ?? r.Text ?? "";
              const sentiment = (r.sentiment ?? r.Sentiment ?? "").toString().toLowerCase().trim();
              if (!review) continue;
              if (sentiment !== "positive" && sentiment !== "negative") continue;
              texts.push(review);
              labels.push(sentiment === "positive" ? 1 : 0);
            }
            resolve({ texts, labels });
          } catch (err) {
            reject(err);
          }
        },
        error: (err) => reject(err),
      });
    });
  }
  
  /**
   * Shuffle arrays in unison
   */
  function shuffleInPlace(a, b, seed = 1337) {
    function mulberry32(s) {
      return function() {
        let t = (s += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(seed);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
      [b[i], b[j]] = [b[j], b[i]];
    }
  }
  
  /**
   * Prepare tensors for training/testing sets.
   */
  export async function prepareTensors({
    texts,
    labels,
    seqLen = 100,
    maxVocab = 20000,
    removeStopwords = false,
    testSplit = 0.2,
  }) {
    if (!texts?.length || !labels?.length) throw new Error("Empty dataset after parsing.");
    if (texts.length !== labels.length) throw new Error("Texts and labels length mismatch.");
  
    // Shuffle
    shuffleInPlace(texts, labels);
  
    // Fit tokenizer
    const tokenizer = new Tokenizer({ numWords: maxVocab, removeStopwords });
    tokenizer.fitOnTexts(texts);
  
    // Convert and pad
    const seqs = tokenizer.textsToSequences(texts);
    const padded = tokenizer.padSequences(seqs, seqLen);
  
    // Split
    const N = padded.length;
    const nTest = Math.max(1, Math.floor(N * testSplit));
    const nTrain = N - nTest;
  
    const xTrain = padded.slice(0, nTrain);
    const xTest = padded.slice(nTrain);
    const yTrain = labels.slice(0, nTrain);
    const yTest = labels.slice(nTrain);
  
    // Tensors
    const X_train = tf.tensor2d(xTrain, [xTrain.length, seqLen], "int32");
    const y_train = tf.tensor1d(yTrain, "int32");
    const X_test = tf.tensor2d(xTest, [xTest.length, seqLen], "int32");
    const y_test = tf.tensor1d(yTest, "int32");
  
    return {
      X_train,
      y_train,
      X_test,
      y_test,
      tokenizerMeta: {
        wordIndex: tokenizer.wordIndex,
        indexWord: tokenizer.indexWord,
        vocabSize: tokenizer.vocabSize,
        seqLen,
        removeStopwords: tokenizer.removeStopwords,
        maxVocab,
      },
      tokenizer, // return instance for app usage (prediction)
      counts: { nTrain, nTest, N },
    };
  }
  