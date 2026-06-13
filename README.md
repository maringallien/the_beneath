# The Beneath

*Descend through the dark, fight or evade what lives there, and find the portal to the surface.*

## About

**The Beneath** is a single-player 2D action-adventure game that runs in the browser. You play a lone survivor descending through a vast, collapsing cave system — fighting and sneaking past the monsters, bandits, and guardians that haunt the deep in search of a hidden portal back to the lost surface. Carry three weapons at once and swap between them on the fly, run, dash, roll, wall-slide, and teleport-strike your way through the tunnels, and scavenge the ammo and magic you need to press ever deeper. Reach the portal, and humanity's last hope of reaching the surface goes with you.

## Tech Stack

- **[TypeScript](https://www.typescriptlang.org/)** — game logic, fully typed
- **[Phaser 3](https://phaser.io/)** — HTML5 game framework (rendering, input, physics, audio)
- **[Vite](https://vitejs.dev/)** — dev server and production bundler
- **[LDtk](https://ldtk.io/)** — level design (levels load from `the_beneath.ldtk`)
- **Web Audio** — music and sound effects, via Phaser's sound manager
- **[Node.js](https://nodejs.org/)** — tooling and package management

## Running the Game

The game was developed and tested on **Ubuntu**.

### Prerequisites

- **Node.js** 18 or newer (tested on v22)
- **npm** (ships with Node.js)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

This launches the Vite dev server and opens the game at **http://localhost:3000**.

### Production build (optional)

```bash
# Type-check, then build to dist/
npm run build

# Serve the production build locally
npm run preview
```
