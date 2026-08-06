/* eslint-env jest */

// channels.js requires these directly at factory top; mock them so requiring
// the route file does not pull in the real database.
jest.mock('../../modules/channelSettingsModule', () => ({
  validateSubFolder: jest.fn().mockReturnValue({ valid: true }),
}));
jest.mock('../../models/channelvideo', () => ({}));

const express = require('express');
const createChannelRoutes = require('../channels');
const { findRouteHandler } = require('../../__tests__/testUtils');

const DOWNLOAD_PATH = '/api/channels/:channelId/videos/:youtubeId/download';

const loggerMock = {
  info: jest.fn(),
  error: jest.fn(),
};

const createResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildDeps = () => ({
  verifyToken: (req, res, next) => next(),
  channelModule: {},
  archiveModule: {},
  channelDownloadAllModule: {
    downloadSingleVideo: jest.fn(),
  },
  ratingMapper: require('../../modules/ratingMapper'),
});

const getHandler = (deps) => {
  const router = createChannelRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use(router);
  return findRouteHandler(app, 'post', DOWNLOAD_PATH);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/channels/:channelId/videos/:youtubeId/download', () => {
  test('queues the download and returns 202 with the queued count', async () => {
    const deps = buildDeps();
    deps.channelDownloadAllModule.downloadSingleVideo.mockResolvedValue({ queued: 1 });

    const handler = getHandler(deps);
    const req = { params: { channelId: 'UC123', youtubeId: 'abc' }, log: loggerMock };
    const res = createResponse();

    await handler(req, res);

    expect(deps.channelDownloadAllModule.downloadSingleVideo).toHaveBeenCalledWith('UC123', 'abc');
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ status: 'accepted', queued: 1 });
  });

  test('returns 404 for an unknown channel', async () => {
    const deps = buildDeps();
    deps.channelDownloadAllModule.downloadSingleVideo.mockRejectedValue(new Error('CHANNEL_NOT_FOUND'));

    const handler = getHandler(deps);
    const req = { params: { channelId: 'UCmissing', youtubeId: 'abc' }, log: loggerMock };
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Video not found' });
  });

  test('returns 404 when the channel video row does not exist', async () => {
    const deps = buildDeps();
    deps.channelDownloadAllModule.downloadSingleVideo.mockRejectedValue(new Error('VIDEO_NOT_FOUND'));

    const handler = getHandler(deps);
    const req = { params: { channelId: 'UC123', youtubeId: 'missing' }, log: loggerMock };
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Video not found' });
  });

  test('returns 409 for an ineligible video', async () => {
    const deps = buildDeps();
    deps.channelDownloadAllModule.downloadSingleVideo.mockRejectedValue(new Error('VIDEO_NOT_ELIGIBLE'));

    const handler = getHandler(deps);
    const req = { params: { channelId: 'UC123', youtubeId: 'abc' }, log: loggerMock };
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Video is not eligible for download' });
  });

  test('returns 409 for an already-downloaded video', async () => {
    const deps = buildDeps();
    deps.channelDownloadAllModule.downloadSingleVideo.mockRejectedValue(new Error('VIDEO_ALREADY_DOWNLOADED'));

    const handler = getHandler(deps);
    const req = { params: { channelId: 'UC123', youtubeId: 'abc' }, log: loggerMock };
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('returns 500 on unexpected errors', async () => {
    const deps = buildDeps();
    deps.channelDownloadAllModule.downloadSingleVideo.mockRejectedValue(new Error('boom'));

    const handler = getHandler(deps);
    const req = { params: { channelId: 'UC123', youtubeId: 'abc' }, log: loggerMock };
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to queue download' });
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
