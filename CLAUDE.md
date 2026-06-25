# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a small JavaScript scratchpad of algorithm exercises. There is no build system, package manager, test framework, or dependencies — it is plain Node.js scripts run directly.

## Running

Each file is a self-contained script with inline `console.log` calls that act as both examples and ad-hoc tests:

```bash
node algo.js
```

There is no `npm install`, lint step, or test runner. To "test" a function, run the file and compare the logged output against the expected results noted in the comments above each `console.log`.

## Conventions

- Each exercise file states the problem in a top-of-file block comment, implements a single solution function (arrow function, `const`), then exercises it with `console.log` calls annotated with the expected return value (e.g. `// should return [0]`).
- Style is informal: no semicolon discipline, 2-space indentation, descriptive inline comments explaining the algorithm step by step.
- When adding a new exercise, follow the same shape — problem statement comment, solution function, then example calls with expected-output comments.
