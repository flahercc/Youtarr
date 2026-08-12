const ChannelVideo = require('../../models/channelvideo');
const { Video, Channel, Playlist, PlaylistVideo } = require('../../models');
const { isEligibleAvailability } = require('../channelDownloadAllModule');

const DEFAULT_LIMIT = 200;

// Cross-channel, cross-playlist "what's new and not yet downloaded or
// ignored" queue backing the Manual Downloads review list. Channel rows
// reuse the eligibility rule channelDownloadAllModule already applies
// per-channel; playlist rows don't need it (see getPlaylistCandidates).
class NewVideoQueueModule {
  async getQueue({ limit = DEFAULT_LIMIT } = {}) {
    const [channelCandidates, playlistCandidates] = await Promise.all([
      this.getChannelCandidates(),
      this.getPlaylistCandidates(),
    ]);

    const candidates = this.dedupeCandidates(channelCandidates, playlistCandidates);
    if (candidates.length === 0) {
      return [];
    }

    const existing = await Video.findAll({
      where: { youtubeId: candidates.map((row) => row.youtube_id) },
      attributes: ['youtubeId'],
    });
    const downloaded = new Set(existing.map((video) => video.youtubeId));

    return candidates
      .filter((row) => !downloaded.has(row.youtube_id))
      .sort((a, b) => this.compareFirstSeenDesc(a, b))
      .slice(0, limit);
  }

  async getChannelCandidates() {
    const channels = await Channel.findAll({
      where: { enabled: true },
      attributes: ['channel_id', 'title'],
    });

    if (channels.length === 0) {
      return [];
    }

    const channelById = new Map(channels.map((channel) => [channel.channel_id, channel]));

    const rows = await ChannelVideo.findAll({
      where: {
        channel_id: Array.from(channelById.keys()),
        ignored: false,
        youtube_removed: false,
      },
      attributes: ['youtube_id', 'channel_id', 'title', 'thumbnail', 'duration', 'availability', 'live_status', 'first_seen_at', 'publishedAt'],
    });

    return rows
      .filter(isEligibleAvailability)
      .map((row) => ({
        source: 'channel',
        youtube_id: row.youtube_id,
        source_id: row.channel_id,
        source_title: channelById.get(row.channel_id)?.title || row.channel_id,
        title: row.title,
        thumbnail: row.thumbnail,
        duration: row.duration,
        first_seen_at: row.first_seen_at,
        published_at: row.publishedAt,
      }));
  }

  // PlaylistVideo rows don't carry availability/live_status (yt-dlp's flat
  // playlist listing never returns them - see playlistModule.js), but they
  // don't need to: playlistModule._fetchPlaylistVideos already filters out
  // unavailable entries (private/deleted placeholders) and the playlist's
  // own duration/title-regex filters before ever persisting a row, so every
  // row here is already eligible.
  async getPlaylistCandidates() {
    const playlists = await Playlist.findAll({
      where: { enabled: true },
      attributes: ['playlist_id', 'title'],
    });

    if (playlists.length === 0) {
      return [];
    }

    const playlistById = new Map(playlists.map((playlist) => [playlist.playlist_id, playlist]));

    const rows = await PlaylistVideo.findAll({
      where: {
        playlist_id: Array.from(playlistById.keys()),
        ignored: false,
      },
      attributes: ['youtube_id', 'playlist_id', 'title', 'thumbnail', 'duration', 'added_at', 'published_at'],
    });

    return rows.map((row) => ({
      source: 'playlist',
      youtube_id: row.youtube_id,
      source_id: row.playlist_id,
      source_title: playlistById.get(row.playlist_id)?.title || row.playlist_id,
      title: row.title,
      thumbnail: row.thumbnail,
      duration: row.duration,
      // added_at is stamped at discovery time and only overwritten to the
      // real download timestamp once a video is downloaded, so for the
      // still-undownloaded rows landing here it's a reliable first-seen time.
      first_seen_at: row.added_at,
      published_at: row.published_at,
    }));
  }

  // A video can be discovered via both a subscribed channel and a subscribed
  // playlist (e.g. a curated playlist containing that channel's uploads) -
  // without this, it would appear twice and a "download selected" bulk
  // action would fire two separate download requests for the same video.
  // Prefer the channel-sourced row: the channel single-video download path
  // has stronger eligibility/already-downloaded guards than the playlist one.
  dedupeCandidates(channelCandidates, playlistCandidates) {
    const byId = new Map(channelCandidates.map((row) => [row.youtube_id, row]));
    for (const row of playlistCandidates) {
      if (!byId.has(row.youtube_id)) {
        byId.set(row.youtube_id, row);
      }
    }
    return Array.from(byId.values());
  }

  // Rows without first_seen_at (legacy, pre-migration) sort after every row
  // that has one, newest first.
  compareFirstSeenDesc(a, b) {
    if (!a.first_seen_at && !b.first_seen_at) return 0;
    if (!a.first_seen_at) return 1;
    if (!b.first_seen_at) return -1;
    return new Date(b.first_seen_at) - new Date(a.first_seen_at);
  }
}

module.exports = new NewVideoQueueModule();
