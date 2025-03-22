# PumpSwap Professional Trading Scanner

A powerful, real-time monitoring tool for trading on the PumpSwap AMM (Automated Market Maker) on Solana. This professional-grade scanner provides actionable trading signals, tracks liquidity changes, monitors transaction volume, and alerts users to new pool listings and significant market movements.

## Features

- **Real-time Pool Monitoring**: Automatically detect new pools as they're created
- **Intelligent Trading Signals**: Get STRONG BUY, BUY, HOLD, SELL, and STRONG SELL signals with confidence ratings
- **Price & Liquidity Tracking**: Monitor changes in token prices and liquidity pools
- **Transaction Volume Analysis**: Track buy/sell volume for specific tokens
- **Automated Alerts**: Get notified when significant buying or selling activity occurs
- **Market Overview**: View total market liquidity, new pool counts, and average pool sizes
- **Historical Data Storage**: Save pool data for trend analysis and performance tracking
- **Direct Trading Links**: Quick access to DEX Screener, Jupiter, Birdeye, GMU.cash, BULLX, and Pump.fun
- **Interactive Commands**: Monitor specific pools of interest
- **Professional UI**: Color-coded, well-formatted output for easy reading

## Requirements

- [Bun](https://bun.sh/) (JavaScript runtime)
- Solana RPC URL (preferably [Helius](https://helius.xyz/) for better performance)
- Node.js v16+ (for development)

## Dependencies

- `@coral-xyz/anchor`: ^0.31.0
- `@solana/spl-token`: ^0.4.13
- `@solana/web3.js`: ^1.98.0
- `dotenv`: ^16.4.7

## Installation

1. **Clone the repository**:
```bash
git clone https://github.com/yourusername/PumpSwap-Scanner.git
cd PumpSwap-Scanner
```

2. **Install Bun** (if not already installed):
```bash
# For macOS, Linux, and WSL
curl -fsSL https://bun.sh/install | bash

# For Windows via PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"
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

For best results, use a premium Solana RPC provider like Helius, QuickNode, or Alchemy.

## Usage

### Starting the Scanner

Run the scanner with:

```bash
bun run index.ts
```

The scanner will automatically:
1. Load any previously saved pool data
2. Set up real-time monitoring for new pools
3. Begin scanning for trading opportunities
4. Start monitoring volume for active pools

### Interactive Commands

While the scanner is running, you can use these commands:

- `monitor <pool_address>` - Start monitoring a specific pool for activity
- `stop <pool_address>` - Stop monitoring a specific pool
- `help` - Show available commands
- `Ctrl+C` - Exit the scanner

### Configuration

You can customize scanner behavior by modifying the `CONFIG` object in `index.ts`:

```typescript
const CONFIG = {
    updateIntervalMinutes: 5,                  // How often to scan all pools
    minLiquiditySol: 0.1,                      // Minimum SOL liquidity to consider
    significantPriceChangePercent: 5,          // Price change threshold
    significantLiquidityChangePercent: 10,     // Liquidity change threshold
    newPoolNotificationThresholdSol: 1,        // Threshold for new pool alerts
    maxPoolsToShow: 15,                        // Max pools in reports
    alertSoundEnabled: true,                   // Play sounds for alerts
    colorOutput: true,                         // Use colored terminal output
    saveHistoricalData: true,                  // Save historical data
    historyRetentionDays: 7,                   // Days to keep history files
    monitorActivePoolsForVolume: true,         // Monitor pools for volume changes
    significantVolumeChangePct: 20,            // Volume change threshold
    poolMonitoringIntervalMinutes: 3           // How often to check pool activity
};
```

## Understanding the Output

### Trading Signals

The scanner identifies trading opportunities with signals like:

```
STRONG BUY (85% confidence)
Reasons: Strong liquidity increase (+25.8%), Positive price momentum (+12.4%)
```

Signals are generated based on:
- Price momentum
- Liquidity changes
- Pool size
- Volume-to-liquidity ratio

### Activity Monitoring

When significant buying or selling is detected:

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
              SIGNIFICANT ACTIVITY DETECTED              
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

Pool: TOKEN/SOL
Address: 9qKxzRejsV6Bp2zkefXWCbGvg61c3hHei7ShXJ4FythA
BUY VOLUME: +10.5 SOL
```

### New Pool Alerts

When new pools are created:

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                 NEW POOL DETECTED                  
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
```

### Trading Links

For each token, you'll get direct links to popular trading platforms:

```
┌─────────────── TRADING LINKS ───────────────┐
│ DEX SCREENER:  https://dexscreener.com/solana/pooladdress
│ JUPITER:      https://jup.ag/swap/SOL-tokenaddress
│ BIRDEYE:      https://birdeye.so/token/tokenaddress?chain=solana
│ GMU.CASH:      https://app.gmu.cash/#/tokens/tokenaddress
│ BULLX:        https://bullx.io/token/tokenaddress
│ PUMP.FUN:     https://pump.fun/token/tokenaddress
└───────────────────────────────────────────┘
```

## Data Storage

The scanner stores data in:

- `./data/pools.json` - Current pool information
- `./data/tokens.json` - Known token addresses
- `./data/history/` - Historical snapshots by date

## Troubleshooting

- **RPC Rate Limits**: If you experience rate limit errors, consider:
  - Using a paid RPC endpoint
  - Increasing delay times between requests
  - Decreasing scan frequency

- **WebSocket Connection Issues**: 
  - Check that your WebSocket URL is correct
  - Some providers require special WebSocket endpoints

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- PumpSwap AMM Team
- Solana Foundation
- Helius for RPC infrastructure