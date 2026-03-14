# POC AI

## Claude Setup

### Plugins

```
/plugin marketplace add anthropics/claude-code
/plugin install frontend-design@claude-code-plugins
```

## Slides

Open `slides/index.html` in a browser (static file, no server needed). Requires the doodle server running for embedded live demos.

### Navigation

| Key | Action |
|---|---|
| Right / Left | Move between main topics |
| Down / Up | Sub-slides within a topic |
| Esc | Overview mode (bird's eye) |
| Space | Next slide (linear) |

---

## Plan

### Demo 1: Doodle Challenge (~15-20 min)

Interactive multiplayer doodle game where participants compete on their phones/laptops.

### Demo 2: Bootstrapping a Project with Claude Code (~25-30 min)

Live-code a project from scratch using Claude Code to showcase AI-assisted development.

### Time Budget

| Segment | Time |
|---|---|
| Intro / context setting | 5 min |
| Demo 1: Doodle Challenge | 15-20 min |
| Demo 2: Claude Code live build | 25-30 min |
| Q&A / buffer | 5-10 min |

---

## Demo 1: Doodle Challenge — Spec

### Overview

A multiplayer browser game where players race to draw recognizable doodles. The AI classifies drawings in real-time using TensorFlow.js (runs entirely in each player's browser — no server-side inference needed).

### Tech Stack

- **Frontend:** HTML Canvas + vanilla JS + ONNX Runtime Web
- **Model:** CNN trained on Google Quick, Draw! dataset (25 categories), PyTorch -> ONNX
- **Backend:** Node.js (Express) with WebSocket (Socket.io) for live leaderboard
- **Networking:** All players connect via same WiFi to host machine's local IP (no accounts or tunnels needed)

### Training the Model

```bash
cd train
python -m venv .venv
.venv/bin/pip install torch torchvision requests onnx onnxscript
.venv/bin/python train_model.py
```

- Downloads ~200MB of Quick, Draw! .npy data (cached in `train/data/`)
- Trains a 3-layer CNN on 200k samples (8k per category)
- Exports to ONNX format in `public/model/model.onnx`
- **Training time:** ~1.5 min on GPU (CUDA), longer on CPU
- **Validation accuracy:** ~90%

### Gameplay Flow

1. Player opens the URL on their phone/laptop and enters a name
2. App displays a random prompt: _"Draw a **cat**"_ + countdown timer (e.g. 20 seconds)
3. Player draws on the canvas
4. Model classifies continuously as the player draws — shows live top-3 predictions
5. When the model's top prediction matches the prompt → **success**, time is recorded
6. Next prompt appears immediately — keep going for N rounds (e.g. 10)
7. If timer runs out → fail, move to next prompt

### Scoring

- **Speed bonus:** faster recognition = more points
- **Streak bonus:** consecutive successes multiply the score
- Formula: `points = max(0, timeLimit - timeTaken) * streakMultiplier`

### Leaderboard

- Visible on a shared "host" screen (projected)
- Updates in real-time via WebSocket as players complete rounds
- Shows: rank, player name, score, current streak, rounds completed

### Pages / Views

1. **Join screen** — name input + "Join" button
2. **Game screen** — canvas, current prompt, timer, live predictions, score
3. **Leaderboard screen** (host view) — full-screen leaderboard for projector

### Word List

Curated subset of Quick, Draw! categories that are fun and recognizable:
cat, dog, house, car, tree, fish, bird, sun, moon, star, flower, hat, shoe, bicycle, airplane, boat, guitar, pizza, apple, banana, clock, heart, smiley face, umbrella, lightning

### Free Drawing Mode

Standalone mode (`/freedraw.html`) with three features:

1. **Free Draw** — draw anything, see live top-5 predictions with color-coded confidence
2. **Show Examples** — display real training samples from any category (click to load onto canvas)
3. **Watch AI Draw** — simulated annealing optimization that mutates pixels to maximize a target category's probability

#### AI Draw as a Talking Point: Adversarial Examples

The AI Draw feature produces images that score 95%+ confidence but look like noise to humans. This is a great demo talking point:

- **Humans draw, AI recognizes** — works well, intuitive
- **AI "draws" to fool itself** — produces gibberish that scores high
- **The punchline:** what convinces the model has nothing to do with what convinces a human — this is exactly why adversarial attacks on AI are a real-world problem (e.g. tricking self-driving cars, bypassing content filters)

### Custom Category Training

Training page (`/train.html`) lets participants teach the model new categories using KNN on the CNN's 128-dim feature space:

1. Enter a category name (e.g. "robot")
2. Draw 3-5 varied samples — each takes effect immediately
3. All participants see the new category in real-time via WebSocket
4. Classification uses cosine similarity against the feature vectors of training samples

**Note:** Custom categories are stored in server memory and lost on restart.

### Non-Goals (keep it simple)

- No user accounts or persistence beyond the session
- No mobile-specific drawing optimizations (canvas touch works well enough)

### Future Improvements

- Persist custom categories to a JSON file so they survive server restarts
- Allow custom categories as game prompts in the challenge mode
