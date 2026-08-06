const ChannelVideo = require('../../models/channelvideo');
const { Video, Channel } = require('../../models');
const { isEligibleAvailability } = require('../channelDownloadAllModule');

const DEFAULT_LIMIT = 200;

// Cross-channel, cross-tab "what's new and not yet downloaded or ignored"
// queue backing the Manual Downloads review list. Reuses the same
// eligibility rule channelDownloadAllModule already applies per-channel.
class NewVideoQueueModule {
  async getQueue({ limit = DEFAULT_LIMIT } = {}) {
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

    const candidates = rows.filter(isEligibleAvailability);
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
      .slice(0, limit)
      .map((row) => ({
        youtube_id: row.youtube_id,
        channel_id: row.channel_id,
        channel_title: channelById.get(row.channel_id)?.title || row.channel_id,
        title: row.title,
        thumbnail: row.thumbnail,
        duration: row.duration,
        first_seen_at: row.first_seen_at,
        published_at: row.publishedAt,
      }));
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
