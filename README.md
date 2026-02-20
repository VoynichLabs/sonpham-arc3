# ARC-AGI-3 Game Playing System

An LLM-powered system for playing [ARC-AGI-3](https://arcprize.org/) interactive reasoning benchmark games. Includes a web-based visual player and a fully autonomous CLI agent.

## What is ARC-AGI-3?

ARC-AGI-3 is an interactive reasoning benchmark where each game is a 64x64 pixel grid with 16 colors. There are no instructions provided — the agent must discover the controls, rules, and goals purely through experimentation.

## Components

- **`server.py`** — Flask web server with a browser-based game player and LLM integration
- **`agent.py`** — Autonomous CLI agent that plays games end-to-end using LLM reasoning
- **`play.py`** — Minimal starter script for exploring games in the terminal

## Supported LLM Providers

| Provider | Models | Cost |
|----------|--------|------|
| Gemini | gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-2.0-flash-lite | Free tier / paid |
| Groq | llama-3.3-70b, gemma2-9b, mixtral-8x7b | Free tier |
| Mistral | mistral-small, open-mistral-nemo | Free tier |
| Ollama | Any locally installed model | Free (local) |

## Setup

```bash
# Clone the repo
git clone https://github.com/sonpham-org/arc-agi-3.git
cd arc-agi-3

# Create a virtual environment and install dependencies
python -m venv venv
source venv/bin/activate
pip install flask python-dotenv arc-agi arcengine httpx google-genai ollama

# Configure API keys (add whichever providers you want to use)
cp .env.example .env
# Edit .env with your keys:
#   GEMINI_API_KEY=...
#   GROQ_API_KEY=...
#   MISTRAL_API_KEY=...
```

## Usage

### Web Player

```bash
python server.py
# Open http://localhost:5000 in your browser
```

The web UI lets you visually interact with any ARC-AGI-3 game and optionally have an LLM suggest moves.

### Autonomous Agent (CLI)

```bash
# Play all games with the default model
python agent.py

# Play a specific game
python agent.py --game ls20

# Use a specific model
python agent.py --model gemini-2.5-flash --game ft09

# List available models
python agent.py --list-models

# Set max steps per game
python agent.py --max-steps 300
```

### Explore Games (Starter Script)

```bash
python play.py
```

## Available Games

The system ships with three local environments:

- `ls20`
- `ft09`
- `vc33`

## Project Structure

```
arc-agi-3/
├── server.py              # Flask web server + LLM API
├── agent.py               # Autonomous CLI agent
├── play.py                # Starter exploration script
├── templates/
│   └── index.html         # Web player UI
├── environment_files/     # Game environment definitions
│   ├── ls20/
│   ├── ft09/
│   └── vc33/
├── .env                   # API keys (not committed)
└── .gitignore
```

## License

This project uses the [arc-agi](https://pypi.org/project/arc-agi/) and [arcengine](https://pypi.org/project/arcengine/) packages from ARC Prize.
