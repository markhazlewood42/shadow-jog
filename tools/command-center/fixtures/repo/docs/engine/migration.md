---
type: design
title: "Shadow Jog Engine — Migration (fixture)"
project: fixture
created: 2026-01-01
updated: 2026-01-02
status: a made-up stand-in for the engine migration plan
tags: [engine, fixture]
---

# Shadow Jog Engine — Migration (fixture)

A made-up stand-in for the engine migration plan, for the tests of the command center. Nothing in it is real: its table only gives the status panel of the Now page a list of milestones to read, and the reading order of the fixture's engine docs a doc to put between the README and the decisions.

## 1. A principle

One made-up principle, so that the table below is not the first thing in the doc.

## 2. The milestones

| Milestone | One-line scope | Touches |
|---|---|---|
| **Phase 0** Platform spike | A spike that tests the design. Done. | `src/` |
| **M0** Kernel | The loop and the first scene. | `src/sje/` |
| **M1b** 3D proof (parallel with M2) | A cube on a canvas. | `src/three/` |
| **M2** Stage | A battle stage. | `src/sje/` |

Each milestone has a heading of its own below, as the real doc has, so that the squares of the status panel have a place to link to. Phase 0 has none.

### M0 Kernel

The loop and the first scene.

### M1b 3D proof

A cube on a canvas.

### M2 Stage

A battle stage.

## 3. A second table

A table that has a Milestone column and no One-line scope column is not the list of milestones, and the status module must skip it.

| Milestone | Moves the content of |
|---|---|
| **M2** Stage | The battle backdrops. |
