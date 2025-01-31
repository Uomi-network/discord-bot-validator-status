# UOMI Network - Validator status discord Bot 🤖

A Discord bot for monitoring UOMI Network validators, providing real-time alerts and status updates for validator performance, slashing events, and network participation.

## Features ✨

- **Real-time Monitoring**
  - Track validator entry/exit from the active set
  - Monitor performance metrics and commission rates
  - Detect slashing events
  - Track inactivity thresholds (10%, 25%, 50%)

- **Notification System**
  - Customizable alerts for followed validators
  - Performance threshold notifications
  - Slashing event alerts
  - Active set changes notifications

- **User Commands**
  - `!follow <address>` - Follow a validator for notifications
  - `!unfollow <address>` - Stop following a validator
  - `!following` - List all validators you're following
  - `!status <address>` - Get detailed validator status
  - `!help` - Display all available commands

## Prerequisites 📋

- Node.js (v16 or higher)
- npm or yarn
- Discord Bot Token
- Access to a UOMI Network node

## Installation 🚀

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/uomi-validator-bot.git
   cd uomi-validator-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CHANNEL_ID=your_channel_id
   SUBSTRATE_WS_URL=your_node_websocket_url
   CHAIN_SS58_PREFIX=87
   COOLDOWN_DAYS=14
   ```

## Configuration ⚙️

The bot can be configured through environment variables:

- `DISCORD_TOKEN`: Your Discord bot token
- `DISCORD_CHANNEL_ID`: Channel ID for notifications
- `SUBSTRATE_WS_URL`: WebSocket URL for your UOMI node (default: ws://localhost:9944)
- `CHAIN_SS58_PREFIX`: UOMI Network SS58 prefix (default: 87)
- `COOLDOWN_DAYS`: Notification cooldown period in days (default: 14)

## Running the Bot 🏃‍♂️

1. Start the bot:
   ```bash
   npm start
   ```

2. The bot will automatically:
   - Connect to Discord
   - Connect to the UOMI Network
   - Load saved validator and follower data
   - Begin monitoring validators

## Monitoring Features 📊

- **Validator Status**
  - Active/Inactive status
  - Commission rates
  - Era points and performance
  - Identity information
  - Slashing history

- **Alert Thresholds**
  - Inactivity alerts at 10%, 25%, and 50%
  - Slashing event notifications
  - Active set entry/exit alerts

## Data Persistence 💾

The bot maintains two JSON files for data persistence:
- `validators.json`: Stores validator information and notification history
- `followers.json`: Stores user-validator following relationships

## Error Handling 🛠️

The bot includes comprehensive error handling for:
- Network connectivity issues
- Invalid addresses
- API failures
- Discord API rate limits

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Support 💬

For support, please join our [Discord server](https://discord.com/invite/KXh72E2gPe) or open an issue in this repository.