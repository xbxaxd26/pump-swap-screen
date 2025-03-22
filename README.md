# PumpSwap Professional Trading Scanner

A real-time trading scanner for PumpSwap AMM on Solana, providing professional-grade market analysis, trading signals, and liquidity monitoring.

## Features

- 🚀 **Real-time pool monitoring** - Get instant notifications when new pools are created
- 📊 **Automatic trading signals** - Buy/sell recommendations based on price and liquidity analysis
- 📈 **Market overview** - Top pools by liquidity and recent activity
- 💹 **Price tracking** - Historical price data and trend analysis
- 📝 **Volume monitoring** - Track buy/sell volume with automatic alerts
- 🔗 **Quick links** - One-click access to DEX, Jupiter, GMGN, BullX and Birdeye
- 💾 **Data persistence** - Historical data saved locally for analysis

## Installation

```bash
# Clone the repository
git clone https://github.com/xbxaxd26/pump-swap-screen.git

# Navigate to project directory
cd pump-swap-screen

# Install dependencies
bun install

# Configure environment variables
cp .env.example .env
# Edit .env with your Solana RPC URL (Helius recommended)

# Run the scanner
bun run index.ts
```

## Requirements

- Bun runtime
- Solana RPC URL (preferably from Helius for best performance)

## Usage

Once running, the scanner will:
1. Display a real-time market overview
2. Alert you to new pool creations
3. Provide trading signals based on price movements and liquidity changes
4. Monitor volume for significant trading activity

### Commands

While the scanner is running, you can use these commands:
- `monitor <pool_address>` - Start monitoring a specific pool
- `stop <pool_address>` - Stop monitoring a specific pool
- `help` - Show command help

## Configuration

Edit the CONFIG object in `index.ts` to customize:
- Minimum liquidity thresholds
- Update intervals
- Alert settings
- Display preferences

## License

MIT

## Disclaimer

This tool is for informational purposes only. Always conduct your own research before trading.