## Plan

### Demo 1: Local AI Doodle Classifier (~15-20 min)

**What works well about this:**
- Visual and interactive — audience can participate by drawing
- Shows AI runs locally, not just in the cloud
- Easy to understand, no domain knowledge needed

**Practical suggestions:**
- Use a small model like **MobileNet** or a fine-tuned version of Google's **Quick, Draw!** dataset (345 categories of doodles, perfect fit)
- A simple stack: HTML canvas for drawing + ONNX Runtime or TensorFlow.js in the browser, or a Python backend with a lightweight model
- Alternatively, use a **multimodal local model** (e.g. LLaVA via Ollama) to classify the doodle — this is simpler to set up and more impressive since it uses general vision, not a purpose-built classifier
- Keep a few pre-drawn doodles ready in case live drawing gets awkward

### Demo 2: Bootstrapping a Project with Claude Code (~25-30 min)

**What works well about this:**
- Shows the practical, day-to-day value of AI for developers
- Live coding is inherently engaging

**Practical suggestions:**
- **Pick the project in advance and rehearse it** — live demos with LLMs can surprise you; know what prompts produce good results
- Good candidates: a small full-stack app (todo app with API + UI), a CLI tool, or a simple game
- Tie it to demo 1 if you want a narrative arc — e.g. "now let's use Claude Code to build the doodle app frontend"
- Show a mix: initial scaffolding, then iterative refinement ("now add a leaderboard"), then maybe a bug fix
- Have a git checkpoint you can reset to if things go sideways

### Time Budget

| Segment | Time |
|---|---|
| Intro / context setting | 5 min |
| Demo 1: Doodle classifier | 15-20 min |
| Demo 2: Claude Code live build | 25-30 min |
| Q&A / buffer | 5-10 min |

### Key Risk Mitigations

- **Rehearse both demos end-to-end** at least once — especially demo 2, since LLM output isn't deterministic
- **Have recordings/screenshots as backup** in case network or API issues hit during the live demo
- **Keep the local model downloaded ahead of time** — don't rely on downloading during the demo
