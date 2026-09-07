# Flappy Bird 2025

A modern, polished, mobile-first endless runner inspired by the classic Flappy Bird — rebuilt for 2025 standards.

![Gameplay](https://img.shields.io/badge/Platform-Mobile%20%26%20Desktop-blue)
![Tech](https://img.shields.io/badge/Tech-HTML5%20Canvas%20%2B%20Vanilla%20JS-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **One-tap controls** – Tap anywhere to flap. Fully playable with one hand.
- **Simple, satisfying physics** – Constant gravity + fixed upward impulse.
- **Procedural pipes** – Neon-accented green pipes with progressive difficulty.
- **Modern visuals**
  - Cute stylized yellow bird with expressive eyes & smooth wing animation
  - Soft pastel sky that slowly cycles day → dusk → night → dawn
  - Subtle city skyline, floating clouds, particle effects
  - Soft screen shake on collision
- **Polished UI** – Large centered score, best score, clean overlays
- **Progressive difficulty** – Gap shrinks and speed increases as you score
- **Local high-score** saving
- **Light haptics** (on supported devices) + soft Web Audio sound effects
- **60 FPS**, lightweight, runs great on mid-range phones
- **Portrait-first**, responsive, works as a PWA-style web app

## How to Run

### Option 1 – Local
1. Clone or download this repo
2. Open `index.html` in any modern browser  
   (or use a simple local server: `npx serve .`)

### Option 2 – GitHub Pages (recommended for mobile)
1. Push this folder to a GitHub repository
2. Go to **Settings → Pages**
3. Set source to `main` branch / root
4. Open the generated URL on your phone

### Option 3 – Add to Home Screen
On mobile Safari / Chrome: open the site → Share → “Add to Home Screen” for a full-screen app-like experience.

## Controls

| Action       | Input                  |
|--------------|------------------------|
| Flap         | Tap / Click / Space    |
| Pause        | Pause button (top right) |
| Restart      | “Try Again” button     |

## Project Structure

```
flappy-bird-2025/
├── index.html          # Main entry
├── css/
│   └── style.css       # Modern UI + overlays
├── js/
│   └── game.js         # Full game engine (physics, render, audio)
└── README.md
```

No build step, no dependencies. Pure HTML / CSS / Vanilla JS.

## Customization

All tunable values live at the top of `js/game.js` in the `CONFIG` object:

- `gravity`, `flapImpulse`
- `pipeGapBase` / `pipeGapMin`
- `pipeSpeedBase` / `pipeSpeedMax`
- `birdSize`, particle counts, etc.

## License

MIT – feel free to use, modify, and ship.

---

Made with ❤️ for the “one more try” feeling.
