const ChannelVideo = require('../models/channelvideo');
const { Video, Channel } = require('../models');
const downloadModule = require('./downloadModule');
const { channelDownloadAllJobLabel, newVideoDownloadJobLabel } = require('./download/jobTypes');
const { MEDIA_TAB_TYPE_MAP } = require('./tabsUtils');
const logger = require('../logger');

const WATCH_URL_PREFIX = 'https://www.youtube.com/watch?v=';

// Mirrors the yt-dlp manual-download match filter
// (availability!=subscriber_only & !is_live & live_status!=is_upcoming), so
// callers agree with what yt-dlp will actually accept. Shared by the
// per-channel-per-tab listing below and the cross-channel new-videos queue
// (newVideoQueueModule), which applies the same rule across tabs/channels.
function isEligibleAvailability(row) {
  return (
    row.availability !== 'subscriber_only' &&
    row.live_status !== 'is_live' &&
    row.live_status !== 'is_upcoming'
  );
}

// "Download all videos for a channel" (one tab at a time). Assumes the caller
// already ran the fetch-all ("Load More") flow, so channelvideos is complete.
class ChannelDownloadAllModule {
  async getDownloadableVideos(channelId, tabType) {
    const mediaType = MEDIA_TAB_TYPE_MAP[tabType] || 'video';

    const rows = await ChannelVideo.findAll({
      where: {
        channel_id: channelId,
        media_type: mediaType,
        ignored: false,
        youtube_removed: false,
      },
      attributes: ['youtube_id', 'duration', 'availability', 'live_status'],
    });

    const candidates = rows.filter(isEligibleAvailability);

    if (candidates.length === 0) {
      return [];
    }

    const existing = await Video.findAll({
      where: { youtubeId: candidates.map((row) => row.youtube_id) },
      attributes: ['youtubeId', 'removed'],
    });
    // Anything ever downloaded is excluded, even deleted rows (removed: true):
    // those stay in the yt-dlp archive, so yt-dlp would skip them and the
    // preview count would overstate.
    const downloaded = new Set(existing.map((video) => video.youtubeId));

    return candidates
      .filter((row) => !downloaded.has(row.youtube_id))
      .map((row) => ({ youtube_id: row.youtube_id, duration: row.duration }));
  }

  async getPreview(channelId, tabType) {
    await this.findChannelOrThrow(channelId);
    const videos = await this.getDownloadableVideos(channelId, tabType);

    let totalDurationSeconds = 0;
    let missingDurations = 0;
    for (const video of videos) {
      if (video.duration == null) {
        missingDurations += 1;
      } else {
        totalDurationSeconds += video.duration;
      }
    }

    return { count: videos.length, totalDurationSeconds, missingDurations };
  }

  async startDownloadAll(channelId, tabType, overrideSettings = {}) {
    const channel = await this.findChannelOrThrow(channelId);
    const videos = await this.getDownloadableVideos(channelId, tabType);

    if (videos.length === 0) {
      return { queued: 0 };
    }

    // The selection already excludes downloaded videos, so allowRedownload is dropped.
    const settings = { ...overrideSettings };
    delete settings.allowRedownload;

    const urls = videos.map((video) => `${WATCH_URL_PREFIX}${video.youtube_id}`);
    await downloadModule.doSpecificDownloads({
      body: {
        urls,
        overrideSettings: settings,
        channelId,
        jobLabel: channelDownloadAllJobLabel(channel),
      },
    });

    logger.info(
      { channelId, tabType, count: urls.length },
      'Queued channel download-all job'
    );

    return { queued: urls.length };
  }

  // Queue a single video discovered by the new-videos scan (see
  // newVideoScanScheduler / newVideoQueueModule). Same eligibility rule and
  // doSpecificDownloads call shape as startDownloadAll, but for one video.
  async downloadSingleVideo(channelId, youtubeId) {
    await this.findChannelOrThrow(channelId);

    const row = await ChannelVideo.findOne({
      where: { channel_id: channelId, youtube_id: youtubeId },
      attributes: ['youtube_id', 'title', 'ignored', 'youtube_removed', 'availability', 'live_status'],
    });

    if (!row) {
      throw new Error('VIDEO_NOT_FOUND');
    }
    if (row.ignored || row.youtube_removed || !isEligibleAvailability(row)) {
      throw new Error('VIDEO_NOT_ELIGIBLE');
    }

    const existing = await Video.findOne({ where: { youtubeId } });
    if (existing) {
      throw new Error('VIDEO_ALREADY_DOWNLOADED');
    }

    await downloadModule.doSpecificDownloads({
      body: {
        urls: [`${WATCH_URL_PREFIX}${youtubeId}`],
        channelId,
        jobLabel: newVideoDownloadJobLabel(row),
      },
    });

    logger.info({ channelId, youtubeId }, 'Queued single new-video download');

    return { queued: 1 };
  }

  async findChannelOrThrow(channelId) {
    const channel = await Channel.findOne({ where: { channel_id: channelId } });
    if (!channel) {
      throw new Error('CHANNEL_NOT_FOUND');
    }
    return channel;
  }
}

module.exports = new ChannelDownloadAllModule();
module.exports.isEligibleAvailability = isEligibleAvailability;
