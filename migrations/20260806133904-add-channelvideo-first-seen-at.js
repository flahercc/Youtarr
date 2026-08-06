'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./helpers');

/**
 * Adds channelvideos.first_seen_at: the timestamp a ChannelVideo row was
 * first discovered by any fetch path (channel page visit, "Load More", or
 * the scheduled new-videos scan). Powers the new-videos queue's "New" badge
 * and sort order. NULL for legacy rows written before this column existed -
 * they simply sort last and show no badge, no backfill needed.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'channelvideos', 'first_seen_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await removeColumnIfExists(queryInterface, 'channelvideos', 'first_seen_at');
  }
};
