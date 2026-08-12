import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import NewVideoQueueCard from '../NewVideoQueueCard';
import { NewQueueVideo, ManualQueueVideo } from '../types';

const video: NewQueueVideo = {
  source: 'channel',
  youtube_id: 'abc',
  source_id: 'UC1',
  source_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 125,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
};

const manualVideo: ManualQueueVideo = {
  source: 'manual',
  youtube_id: 'manual1',
  source_id: null,
  source_title: 'Some Channel',
  title: 'Manual Video',
  thumbnail: 'https://example.com/thumb2.jpg',
  duration: 90,
  first_seen_at: null,
  published_at: null,
  is_already_downloaded: false,
  is_members_only: false,
  is_bulk_import: false,
};

describe('NewVideoQueueCard', () => {
  test('renders the title, source, and formatted duration', () => {
    render(
      <NewVideoQueueCard
        video={video}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={jest.fn()}
        onRemove={jest.fn()}
      />
    );

    expect(screen.getByText('Cool Video')).toBeInTheDocument();
    expect(screen.getByText(/Channel One/)).toBeInTheDocument();
    expect(screen.getByText(/2:05/)).toBeInTheDocument();
  });

  test('calls onDownload when the download button is clicked', async () => {
    const user = userEvent.setup();
    const onDownload = jest.fn();
    render(
      <NewVideoQueueCard
        video={video}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={onDownload}
        onRemove={jest.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Download Cool Video/i }));

    expect(onDownload).toHaveBeenCalledWith(video);
  });

  test('calls onRemove when the ignore button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = jest.fn();
    render(
      <NewVideoQueueCard
        video={video}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={jest.fn()}
        onRemove={onRemove}
      />
    );

    await user.click(screen.getByRole('button', { name: /Ignore Cool Video/i }));

    expect(onRemove).toHaveBeenCalledWith(video);
  });

  test('calls onToggleSelect when the checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onToggleSelect = jest.fn();
    render(
      <NewVideoQueueCard
        video={video}
        selected={false}
        onToggleSelect={onToggleSelect}
        onDownload={jest.fn()}
        onRemove={jest.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /Select Cool Video/i }));

    expect(onToggleSelect).toHaveBeenCalledWith(video);
  });

  describe('manual video', () => {
    test('has no instant-download button, only a remove action', () => {
      render(
        <NewVideoQueueCard
          video={manualVideo}
          selected={false}
          onToggleSelect={jest.fn()}
          onDownload={jest.fn()}
          onRemove={jest.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /Download/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remove Manual Video/i })).toBeInTheDocument();
    });

    test('shows a members-only indicator', () => {
      render(
        <NewVideoQueueCard
          video={{ ...manualVideo, is_members_only: true }}
          selected={false}
          onToggleSelect={jest.fn()}
          onDownload={jest.fn()}
          onRemove={jest.fn()}
        />
      );

      expect(screen.getByTestId('LockIcon')).toBeInTheDocument();
    });

    test('shows a bulk-import stub title while awaiting enrichment', () => {
      render(
        <NewVideoQueueCard
          video={{ ...manualVideo, is_bulk_import: true }}
          selected={false}
          onToggleSelect={jest.fn()}
          onDownload={jest.fn()}
          onRemove={jest.fn()}
        />
      );

      expect(screen.getByText('Fetching details...')).toBeInTheDocument();
    });
  });
});
