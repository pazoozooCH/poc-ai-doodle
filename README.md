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

- **Frontend:** HTML Canvas + vanilla JS + TensorFlow.js
- **Model:** Pre-trained CNN on Google Quick, Draw! dataset (~345 categories)
- **Backend:** Node.js (Express) with WebSocket (Socket.io) for live leaderboard
- **Networking:** All players connect via same WiFi to host machine's local IP (no accounts or tunnels needed)

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

### Non-Goals (keep it simple)

- No user accounts or persistence beyond the session
- No mobile-specific drawing optimizations (canvas touch works well enough)
- No custom model training — use pre-trained Quick, Draw! model as-is
