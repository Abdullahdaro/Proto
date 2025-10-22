**Role:**
You are an expert machine learning developer building a fully browser-based, GitHub Pages-deployable **Customer Sentiment Analyzer**. Everything must run client-side with **TensorFlow.js**. The solution must load a CSV file of customer reviews and their sentiment labels (positive/negative), train an RNN (GRU/LSTM)-based text classifier entirely in-browser, and provide interactive visualization of classification performance.

**Task:**

* Read the user’s local CSV file (e.g., `"IMDB Dataset.csv"`) containing two columns: `review`, `sentiment` (values: `"positive"` or `"negative"`).
* Preprocess the text data: lowercase, remove punctuation, tokenize words, convert to integer sequences, and pad/truncate each to a fixed sequence length.
* Encode labels to binary (1 for positive, 0 for negative).
* Build, train, and evaluate an RNN (using GRU layers) for binary text classification entirely in-browser with TensorFlow.js.
* After prediction, compute overall accuracy, precision, recall, F1 score, and visualize the results with charts showing training progress, confusion matrix, and per-sample prediction correctness.
* All code must be organized into these three JS modules: `data-loader.js`, `rnn.js`, and `app.js`.

**Instruction:**

* `index.html` (not included here) should have UI to upload the CSV, configure hyperparameters (epochs, batch size), launch training, show progress, and visualize results.

* `data-loader.js`:

  * Parse the uploaded CSV using PapaParse or FileReader API.
  * Clean and preprocess text (lowercase, strip punctuation, optional stopword removal).
  * Tokenize words to integer IDs using a custom tokenizer class (build in JS).
  * Pad sequences to fixed length (e.g., 100 tokens).
  * Encode labels (`positive` → 1, `negative` → 0).
  * Split data randomly into training and test sets (e.g., 80/20).
  * Export tensors: `X_train`, `y_train`, `X_test`, `y_test`, and tokenizer metadata.

* `rnn.js`:

  * Define and compile a TensorFlow.js sequential model:

    * Embedding layer (`input_dim = vocab_size`, `output_dim = 64`, `input_length = seq_len`)
    * GRU or Bidirectional GRU layer (e.g., 128 units, dropout 0.2).
    * Dense(1, activation='sigmoid') for binary classification.
  * Compile with `binaryCrossentropy` loss and `adam` optimizer.
  * Provide functions:

    * `trainModel(X_train, y_train, ...)`
    * `evaluateModel(X_test, y_test)`
    * `predict(text)` (single review)
    * `saveModel()` and `loadModel()`
  * Include progress callbacks for training visualization.
  * Handle GPU/CPU switching, memory disposal, and invalid input shapes gracefully.

* `app.js`:

  * Connect the UI to model training and evaluation.
  * Display real-time training metrics (loss/accuracy chart).
  * After evaluation:

    * Compute and display accuracy, precision, recall, and F1.
    * Render a confusion matrix (true vs predicted).
    * Display per-sample results (green for correct, red for wrong) in a scrollable table.
  * Include a text input box where the user can type a new review and instantly get the predicted sentiment with probability.
  * Use Chart.js or tfjs-vis for all visualizations.
  * Ensure clean memory management (dispose tensors) and robust error handling for missing data or shape mismatches.

**All files must:**

* Use `tf.js` via CDN (`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs`) and pure ES6 modules.
* Be fully client-side and deployable directly via GitHub Pages (no backend).
* Include clear English comments explaining each major step.

**Format:**
Output exactly **four code blocks** labeled:

* `index.html`
* `data-loader.js`
* `rnn.js`
* `app.js`

No explanations — only code inside the code blocks.
