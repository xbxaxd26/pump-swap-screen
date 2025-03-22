# Contributing to PumpSwap Professional Trading Scanner

Thank you for your interest in contributing to this project! This document provides guidelines and instructions for contributing.

## Ways to Contribute

1. **Bug Reports**: If you find a bug, please create an issue with a detailed description.
2. **Feature Requests**: Have an idea for a new feature? Open an issue to discuss it.
3. **Code Contributions**: Want to fix bugs or add features? Read on!

## Development Setup

1. **Fork the repository** to your GitHub account
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
   cd YOUR_REPOSITORY_NAME
   ```
3. **Install dependencies**:
   ```bash
   bun install
   ```
4. **Set up your environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Solana RPC URL
   ```

## Making Changes

1. **Create a new branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```
   
2. **Make your changes**: Follow the existing code style and patterns.

3. **Testing**:
   - Test your changes thoroughly before submitting
   - Ensure the scanner still functions correctly

4. **Commit your changes**:
   ```bash
   git commit -m "Add feature X" -m "Detailed description of changes"
   ```

## Submitting a Pull Request

1. **Push your changes** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request** from your fork to the main repository.

3. **Describe your changes** in the PR description:
   - What problem does it solve?
   - How does it work?
   - Any notes on implementation?

## Coding Standards

- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused
- Follow existing patterns in the codebase

## Feature Ideas

Here are some ideas if you're looking for ways to contribute:

- Add support for more trading signals or indicators
- Improve transaction volume detection accuracy
- Add historical price chart visualization
- Implement notifications via Telegram/Discord
- Add cross-platform support for alert sounds
- Create a web interface for the scanner

Thank you for helping improve the PumpSwap Professional Trading Scanner! 