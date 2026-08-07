const cron = require('node-cron');
const logger = require('../../logger');
const configModule = require('../configModule');
const Channel = require('../../models/channel');
const ChannelVideo = require('../../models/channelvideo');
const channelVideoFetcher = require('./channelVideoFetcher');
const channelVideoQuery = require('./channelVideoQuery');
const { MEDIA_TAB_TYPE_MAP, parseTabCsv } = require('../tabsUtils');

// Belt-and-braces default matching config.example.json, mirroring
// watchStatusScheduler's DEFAULT_SYNC_FREQUENCY handling.
const DEFAULT_SCAN_TIME = '14:00';
const DEFAULT_SCAN_VIDEO_LIMIT = channelVideoFetcher.DEFAULT_MAX_VIDEO_COUNT;

// auto_download_enabled_tabs stores mediaType values ('video'/'short'/
// 'livestream'); fetchChannelVideos needs the tabType ('videos'/'shorts'/
// 'streams'). Invert the canonical map instead of hand-writing a second one.
const TAB_TYPE_BY_MEDIA_TYPE = Object.fromEntries(
  Object.entries(MEDIA_TAB_TYPE_MAP).map(([tabType, mediaType]) => [mediaType, tabType])
);

class NewVideoScanScheduler {
  constructor() {
    this.scanning = false;
  }

  /**
   * Schedule or reschedule the daily new-videos scan.
   * Manages cron job based on configuration settings.
   * @returns {void}
   */
  scheduleTask() {
    const config = configModule.getConfig();
    const time = config.channelScanTime || DEFAULT_SCAN_TIME;

    if (this.task) {
      this.task.stop();
      this.task = null;
    }

    if (!config.channelScanEnabled) {
      logger.info('Channel scan disabled');
      return;
    }

    const cronExpression = this.timeToCron(time);
    if (!cronExpression || !cron.validate(cronExpression)) {
      logger.warn({ time }, 'Invalid channel scan time; not scheduling');
      return;
    }

    this.task = cron.schedule(cronExpression, () => {
      this.scanAllChannels().catch((err) => {
        logger.error({ err }, 'Scheduled channel scan failed');
      });
    });
    logger.info({ time, cronExpression }, 'Channel scan scheduled');
  }

  /**
   * Subscribe to configuration changes.
   * Reschedules the scan when configuration is updated.
   * @returns {void}
   */
  subscribe() {
    configModule.onConfigChange(this.scheduleTask.bind(this));
  }

  /**
   * Convert an "HH:MM" time-of-day (server-local) into a daily cron
   * expression. Returns null for a malformed time string.
   * @param {string} time
   * @returns {string|null}
   */
  timeToCron(time) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
    if (!match) return null;
    const [, hour, minute] = match;
    return `${Number(minute)} ${Number(hour)} * * *`;
  }

  /**
   * Scan every enabled channel's auto-download-enabled tabs for videos not
   * previously seen, reusing the same fetch/insert pipeline that channel
   * page visits and "Load More" already use. One channel/tab failing does
   * not stop the rest. Throws SCAN_IN_PROGRESS if a scan is already running.
   * @returns {Promise<{channelsScanned: number, tabsScanned: number, newVideosFound: number, errors: Array<{channelId: string, tabType: string, message: string}>}>}
   */
  async scanAllChannels() {
    if (this.scanning) {
      throw new Error('SCAN_IN_PROGRESS');
    }
    this.scanning = true;

    const summary = { channelsScanned: 0, tabsScanned: 0, newVideosFound: 0, errors: [] };

    try {
      const channels = await Channel.findAll({ where: { enabled: true } });

      for (const channel of channels) {
        const tabTypes = parseTabCsv(channel.auto_download_enabled_tabs)
          .map((mediaType) => TAB_TYPE_BY_MEDIA_TYPE[mediaType])
          .filter(Boolean);

        if (tabTypes.length === 0) continue;
        summary.channelsScanned += 1;

        for (const tabType of tabTypes) {
          summary.tabsScanned += 1;
          await this.scanChannelTab(channel, tabType, summary);
        }
      }

      logger.info(summary, 'Channel scan complete');
      return summary;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Refresh a single channel/tab and tally any newly-discovered videos onto
   * the running summary. Isolated per tab so one failure can't sink the scan.
   * @param {Object} channel - Channel database record
   * @param {string} tabType - 'videos' | 'shorts' | 'streams'
   * @param {Object} summary - Running scan summary, mutated in place
   * @returns {Promise<void>}
   * @private
   */
  async scanChannelTab(channel, tabType, summary) {
    const mediaType = MEDIA_TAB_TYPE_MAP[tabType];
    try {
      const recentVideos = await channelVideoQuery.fetchNewestVideosFromDb(
        channel.channel_id, 1, 0, 'off', '', 'date', 'desc', false, mediaType
      );

      if (!channelVideoFetcher.shouldRefreshChannelVideos(channel, recentVideos.length, mediaType)) {
        return;
      }

      const mostRecentVideoDate = recentVideos.length > 0 ? recentVideos[0].publishedAt : null;
      const beforeCount = await ChannelVideo.count({
        where: { channel_id: channel.channel_id, media_type: mediaType },
      });

      const maxVideoCount = configModule.getConfig().channelScanVideoLimit || DEFAULT_SCAN_VIDEO_LIMIT;
      await channelVideoFetcher.fetchAndSaveVideosViaYtDlp(channel, channel.channel_id, tabType, mostRecentVideoDate, maxVideoCount);

      const afterCount = await ChannelVideo.count({
        where: { channel_id: channel.channel_id, media_type: mediaType },
      });
      summary.newVideosFound += Math.max(0, afterCount - beforeCount);
    } catch (err) {
      logger.error({ err, channelId: channel.channel_id, tabType }, 'Channel scan failed for tab');
      summary.errors.push({ channelId: channel.channel_id, tabType, message: err.message });
    }
  }
}

module.exports = new NewVideoScanScheduler();
