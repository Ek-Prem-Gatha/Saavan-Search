# Saavan Search

**Stream music directly from Saavan.**

This plugin integrates the Saavan music catalog into Audion, allowing you to search for tracks, albums, playlists, and artists, and stream them directly within the app.

## Features

- **Direct Search**: Search the entire Saavan catalog for Tracks, Albums, Playlists ,and Artists.
- **Library Integration**: Save tracks directly to your Audion library with a single click.
- **Album Browsing**: View full album details, tracklists, and release dates.
- **Artist Discography**: Explore an artist's full catalog of albums.
- **"Save All"**: Add entire albums to your library at once.
- **Visual Polish**: Beautiful grid layouts, skeleton loading states, and responsive design.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `saavan-search`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

1. **Open Search**: Click the **Saavan** button in the player bar.
2. **Search**: Type your query in the search bar.
3. **Filter**: Switch between **Tracks** and **Albums** tabs.
4. **Play**: Click any track to start streaming immediately.
5. **Save**: Click the Heart icon next to any track to add it to your local library.
6. **Browse**: Click on an Artist or Album card to view more details.

## Configuration

This plugin uses a custom API proxy (`api.paxsenix.org`) to interface with Saavan. No personal Saavan account login is required for standard streaming, as it uses the proxy's resolution capabilities.

## Permissions

This plugin requires the following permissions:
- `network:fetch`: To search and stream from the API.
- `ui:inject`: To show the search panel.
- `player:control`: To play tracks.
- `library:write`: To save tracks to your library.
- `library:read`: To check if tracks are already saved.
- `settings:write`: To save settings.
- `library:downloadTrack`: To download songs.