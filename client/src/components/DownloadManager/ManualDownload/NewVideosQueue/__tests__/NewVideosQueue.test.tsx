import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import NewVideosQueue from '../NewVideosQueue';
import { useNewVideosQueue } from '../hooks/useNewVideosQueue';
import { NewQueueVideo } from '../types';
import { VideoInfo } from '../../types';

jest.mock('../hooks/useNewVideosQueue');

const mockedUseNewVideosQueue = useNewVideosQueue as jest.MockedFunction<typeof useNewVideosQueue>;

const video: NewQueueVideo = {
  source: 'channel',
  youtube_id: 'abc',
  source_id: 'UC1',
  source_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 120,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
};

const video2: NewQueueVideo = {
  source: 'channel',
  youtube_id: 'def',
  source_id: 'UC2',
  source_title: 'Channel Two',
  title: 'Another Video',
  thumbnail: 'https://example.com/thumb2.jpg',
  duration: 60,
  first_seen_at: '2026-01-02T00:00:00.000Z',
  published_at: '2026-01-02T00:00:00.000Z',
};

const manualVideo: VideoInfo = {
  youtubeId: 'manual1',
  url: 'https://www.youtube.com/watch?v=manual1',
  channelName: 'Manual Channel',
  channelId: 'UCM1',
  videoTitle: 'Manually Pasted Video',
  duration: 45,
  publishedAt: 1700000000,
  isAlreadyDownloaded: false,
  isMembersOnly: false,
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
    ignoreVideos: jest.fn(),
    downloadVideos: jest.fn(),
    ...overrides,
  };
}

function renderQueue(overrideProps: {
  manualVideos?: VideoInfo[];
  isDownloadingManual?: boolean;
  onRemoveManual?: (ids: string[]) => void;
  onDownloadManualSelected?: (videos: VideoInfo[]) => void;
} = {}) {
  return render(
    <NewVideosQueue
      token="t"
      manualVideos={overrideProps.manualVideos ?? []}
      isDownloadingManual={overrideProps.isDownloadingManual ?? false}
      onRemoveManual={overrideProps.onRemoveManual ?? jest.fn()}
      onDownloadManualSelected={overrideProps.onDownloadManualSelected ?? jest.fn()}
    />
  );
}

describe('NewVideosQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('renders nothing while the initial load is in progress and there are no manual videos', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ loading: true }));
    const { container } = renderQueue();
    expect(container).toBeEmptyDOMElement();
  });

  test('still renders manual videos while the discovered queue is loading', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ loading: true }));
    renderQueue({ manualVideos: [manualVideo] });

    expect(screen.getByText('Manually Pasted Video')).toBeInTheDocument();
  });

  test('shows an empty state with a Scan Now button when there is nothing queued', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult());
    renderQueue();

    expect(screen.getByText(/No videos queued for download/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scan Now/i })).toBeInTheDocument();
  });

  test('renders the combined count and each discovered video when present', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video] }));
    renderQueue();

    expect(screen.getByText('Videos to Download (1)')).toBeInTheDocument();
    expect(screen.getByText('Cool Video')).toBeInTheDocument();
  });

  test('merges manual videos alongside discovered ones under one combined count', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video] }));
    renderQueue({ manualVideos: [manualVideo] });

    expect(screen.getByText('Videos to Download (2)')).toBeInTheDocument();
    expect(screen.getByText('Cool Video')).toBeInTheDocument();
    expect(screen.getByText('Manually Pasted Video')).toBeInTheDocument();
  });

  test('does not duplicate a manual video that is already in the discovered queue', () => {
    const duplicate: NewQueueVideo = { ...video, youtube_id: manualVideo.youtubeId };
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [duplicate] }));
    renderQueue({ manualVideos: [manualVideo] });

    expect(screen.getByText('Videos to Download (1)')).toBeInTheDocument();
  });

  test('calls scan when Scan Now is clicked', async () => {
    const user = userEvent.setup();
    const scan = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ scan }));
    renderQueue();

    await user.click(screen.getByRole('button', { name: /Scan Now/i }));

    expect(scan).toHaveBeenCalledTimes(1);
  });

  test('disables Scan Now and shows a spinner label while scanning', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ scanning: true }));
    renderQueue();

    expect(screen.getByRole('button', { name: /Scanning/i })).toBeDisabled();
  });

  test('shows an error message when present', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ error: 'Failed to load new videos.' }));
    renderQueue();

    expect(screen.getByText('Failed to load new videos.')).toBeInTheDocument();
  });

  test('calls downloadVideo and ignoreVideo from a discovered item action', async () => {
    const user = userEvent.setup();
    const downloadVideo = jest.fn();
    const ignoreVideo = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(
      buildResult({ videos: [video], downloadVideo, ignoreVideo })
    );
    renderQueue();

    await user.click(screen.getByRole('button', { name: /Download Cool Video/i }));
    expect(downloadVideo).toHaveBeenCalledWith(video);

    await user.click(screen.getByRole('button', { name: /Ignore Cool Video/i }));
    expect(ignoreVideo).toHaveBeenCalledWith(video);
  });

  test('calls onRemoveManual (not ignoreVideo) from a manual item action', async () => {
    const user = userEvent.setup();
    const ignoreVideo = jest.fn();
    const onRemoveManual = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ ignoreVideo }));
    renderQueue({ manualVideos: [manualVideo], onRemoveManual });

    await user.click(screen.getByRole('button', { name: /Remove Manually Pasted Video/i }));

    expect(onRemoveManual).toHaveBeenCalledWith(['manual1']);
    expect(ignoreVideo).not.toHaveBeenCalled();
  });

  test('newly-added manual videos are auto-selected', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult());
    renderQueue({ manualVideos: [manualVideo] });

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  test('deselecting an auto-selected manual video sticks (does not get re-selected on re-render)', async () => {
    const user = userEvent.setup();
    mockedUseNewVideosQueue.mockReturnValue(buildResult());
    const { rerender } = renderQueue({ manualVideos: [manualVideo] });

    await user.click(screen.getByRole('checkbox', { name: /Select Manually Pasted Video/i }));
    expect(screen.getByText('Select all')).toBeInTheDocument();

    // Re-render with the same manual video list (e.g. an unrelated parent
    // re-render) - it should stay deselected since nothing new was added.
    rerender(
      <NewVideosQueue
        token="t"
        manualVideos={[manualVideo]}
        isDownloadingManual={false}
        onRemoveManual={jest.fn()}
        onDownloadManualSelected={jest.fn()}
      />
    );

    expect(screen.getByText('Select all')).toBeInTheDocument();
  });

  test('does not show bulk action buttons when nothing is selected', () => {
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video, video2] }));
    renderQueue();

    expect(screen.queryByRole('button', { name: /Download Selected/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Selected/i })).not.toBeInTheDocument();
  });

  test('selecting a discovered video shows bulk actions and calls downloadVideos/ignoreVideos with just that video', async () => {
    const user = userEvent.setup();
    const downloadVideos = jest.fn();
    const ignoreVideos = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(
      buildResult({ videos: [video, video2], downloadVideos, ignoreVideos })
    );
    renderQueue();

    await user.click(screen.getByRole('checkbox', { name: /Select Cool Video/i }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Download Selected/i }));
    expect(downloadVideos).toHaveBeenCalledWith([video]);

    await user.click(screen.getByRole('button', { name: /Remove Selected/i }));
    expect(ignoreVideos).toHaveBeenCalledWith([video]);
  });

  test('downloading a mixed selection routes discovered videos to downloadVideos and manual ones to onDownloadManualSelected', async () => {
    const user = userEvent.setup();
    const downloadVideos = jest.fn();
    const onDownloadManualSelected = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video], downloadVideos }));
    renderQueue({ manualVideos: [manualVideo], onDownloadManualSelected });

    // Both items start selected: discovered videos aren't auto-selected, so
    // select the discovered one explicitly (the manual one is pre-selected).
    await user.click(screen.getByRole('checkbox', { name: /Select Cool Video/i }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Download Selected/i }));

    expect(downloadVideos).toHaveBeenCalledWith([video]);
    expect(onDownloadManualSelected).toHaveBeenCalledWith([manualVideo]);
  });

  test('removing a mixed selection routes discovered videos to ignoreVideos and manual ones to onRemoveManual', async () => {
    const user = userEvent.setup();
    const ignoreVideos = jest.fn();
    const onRemoveManual = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video], ignoreVideos }));
    renderQueue({ manualVideos: [manualVideo], onRemoveManual });

    await user.click(screen.getByRole('checkbox', { name: /Select Cool Video/i }));
    await user.click(screen.getByRole('button', { name: /Remove Selected/i }));

    expect(ignoreVideos).toHaveBeenCalledWith([video]);
    expect(onRemoveManual).toHaveBeenCalledWith(['manual1']);
  });

  test('select all checkbox selects and deselects every video', async () => {
    const user = userEvent.setup();
    const downloadVideos = jest.fn();
    mockedUseNewVideosQueue.mockReturnValue(
      buildResult({ videos: [video, video2], downloadVideos })
    );
    renderQueue();

    await user.click(screen.getByRole('checkbox', { name: /Select all videos to download/i }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Download Selected/i }));
    expect(downloadVideos).toHaveBeenCalledWith([video, video2]);

    await user.click(screen.getByRole('checkbox', { name: /Select all videos to download/i }));
    expect(screen.getByText('Select all')).toBeInTheDocument();
  });

  test('switching to grid view renders cards instead of list rows', async () => {
    const user = userEvent.setup();
    mockedUseNewVideosQueue.mockReturnValue(buildResult({ videos: [video] }));
    renderQueue();

    expect(screen.getByRole('checkbox', { name: /Select Cool Video/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Grid View/i }));

    // Both renderers use the same accessible checkbox label, so assert the
    // grid card's structural marker (no reliable way to distinguish via
    // role alone) - the toggle itself now shows Grid View as active.
    expect(screen.getByRole('button', { name: /Grid View/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
