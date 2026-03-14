# AI Today

What can AI do in practice?

Lunch Demo — 2026

---

## Agenda

1. **Doodle Challenge** — local AI in the browser
2. **Live Coding with Claude** — AI-assisted development
3. Q&A

---

## Demo 1: Doodle Challenge

Can AI recognize your doodles?

---

### How it works

- CNN trained on Google's Quick, Draw! dataset
- 25 categories, 200k training samples
- ~90% accuracy on test data
- Model runs *in your browser* (ONNX Runtime)
- 28x28 pixel input, <1 MB model
- Training: ~1.5 min on GPU

---

### No cloud needed

The model runs **entirely on your device**

- No API calls, no latency, no data leaving your phone
- Classification every 300ms as you draw
- Server only handles the leaderboard

---

### Let's play!

Open on your phone:

`http://???:3000`

---

<!-- leaderboard iframe inserted via HTML -->

---

### Free Drawing Mode

What does the AI see when you draw?

- Live top-5 predictions with confidence scores
- Debug preview: the 28x28 pixels the model actually sees

---

<!-- freedraw iframe inserted via HTML -->

---

### Watch AI Draw: Adversarial Examples

- AI optimizes pixels to maximize a target category
- Result: 95%+ confidence — but looks like noise to humans
- This is why adversarial attacks on AI are a real problem

*Self-driving cars, content filters, biometric systems...*

---

### Teach it something new

Transfer learning with KNN on the feature space

- Draw 3–5 samples of a new category
- Uses the CNN's 128-dim features + cosine similarity
- No retraining needed — works instantly
- Shared across all participants via WebSocket

---

<!-- train iframe inserted via HTML -->

---

### Demo 1 Takeaways

- AI models can be **tiny** (<1 MB) and run locally
- Training data quality matters more than quantity
- Transfer learning: reuse features for new tasks
- AI confidence ≠ human perception (adversarial examples)

---

## Demo 2: Live Coding with Claude

AI-assisted software development

---

### Claude Code

- CLI tool that understands your entire codebase
- Reads files, writes code, runs commands
- Iterates: writes → tests → fixes → commits
- Not autocomplete — an autonomous coding agent

---

### What we'll build

*(live demo)*

---

### Demo 2 Takeaways

- AI accelerates development, doesn't replace understanding
- Best for: scaffolding, boilerplate, iteration, exploration
- You still need to review, guide, and decide

---

## Key Messages

1. AI runs **locally** — not everything needs the cloud
2. Small models can be **surprisingly capable**
3. AI is a **tool** — powerful but needs human judgement

---

## Questions?
