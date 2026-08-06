import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import NewVideosQueue from '../NewVideosQueue';
import { useNewVideosQueue } from '../hooks/useNewVideosQueue';
import { NewQueueVideo } from '../types';

jest.mock('../hooks/useNewVideosQueue');

const mockedUseNewVideosQueue = useNewVideosQueue as jest.MockedFunction<typeof useNewVideosQueue>;

const video: NewQueueVideo = {
  youtube_id: 'abc',
  channel_id: 'UC1',
  channel_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 120,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
};

function buildResult(overrides: Partial<ReturnType<typeof useNewVideosQueue>> = {}) {
  return {
    videos: [],
    loading: false,
    error: null,
    scanning: false,
    scan: jest.fn(),
    ignoreVideo: jest.fn(),
    downloadVideo: jest.fn(),
    ...overrides,
  };
}

describe('NewVideosQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders nothing while the initial load is in progress', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ loading: true }));
    const { container } = render(<NewVideosQueue token="t" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows an empty state with a Scan Now button when the queue is empty', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult());
    render(<NewVideosQueue token="t" />);

    expect(screen.getByText(/No new videos found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scan Now/i })).toBeInTheDocument();
  });

  test('renders the queue count and each video when videos are present', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video] }));
    render(<NewVideosQueue token="t" />);

    expect(screen.getByText('New Videos (1)')).toBeInTheDocument();
    expect(screen.getByText('Cool Video')).toBeInTheDocument();
  });

  test('calls scan when Scan Now is clicked', async () => {
    const user = userEvent.setup();
    const scan = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ scan }));
    render(<NewVideosQueue token="t" />);

    await user.click(screen.getByRole('button', { name: /Scan Now/i }));

    expect(scan).toHaveBeenCalledTimes(1);
  });

  test('disables Scan Now and shows a spinner label while scanning', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ scanning: true }));
    render(<NewVideosQueue token="t" />);

    expect(screen.getByRole('button', { name: /Scanning/i })).toBeDisabled();
  });

  test('shows an error message when present', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ error: 'Failed to load new videos.' }));
    render(<NewVideosQueue token="t" />);

    expect(screen.getByText('Failed to load new videos.')).toBeInTheDocument();
  });

  test('calls downloadVideo and ignoreVideo from the item actions', async () => {
    const user = userEvent.setup();
    const downloadVideo = jest.fn();
    const ignoreVideo = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(
      buildResult({ videos: [video], downloadVideo, ignoreVideo })
    );
    render(<NewVideosQueue token="t" />);

    await user.click(screen.getByRole('button', { name: /Download Cool Video/i }));
    expect(downloadVideo).toHaveBeenCalledWith(video);

    await user.click(screen.getByRole('button', { name: /Ignore Cool Video/i }));
    expect(ignoreVideo).toHaveBeenCalledWith(video);
  });
});
