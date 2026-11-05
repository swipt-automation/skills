---
name: swipt
description: Swipt is the universal iOS automation platform. Use this skill to automate, operate or observe an iPhone or iPad through Swipt, to develop Swiplets, and to install Swipt.
---

# Swipt

The universal iOS automation platform.

## Requirements

- iOS 27

## Architecture

- Swipt SDK: A TypeScript SDK built upon CoreDevice, Accessibility services, and other developer services.
- Swipt API (MCP-compatible): Allows you to run a JS REPL based on the Swipt SDK directly, enabling you to control an iPhone or iPad, manage and debug Swiplets.
- Swipt CLI: A client for the Swipt API that offers a more comprehensive set of features than MCP.
- Swiplet: Apps that run within Swipt, built using the Swipt SDK and SwiftUI.

## References

- `references/api/*.d.ts`: for SDK declarations and REPL globals
- `references/cli.txt`: for Swipt CLI commands and options
- `references/docs/**/*.mdx`: for English documentation
