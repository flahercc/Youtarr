import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import NewVideoQueueItem from '../NewVideoQueueItem';
import { NewQueueVideo } from '../types';

const video: NewQueueVideo = {
  youtube_id: 'abc',
  channel_id: 'UC1',
  channel_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 125,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
};

describe('NewVideoQueueItem', () => {
  test('renders the title, channel name, and formatted duration', () => {
    render(
      <NewVideoQueueItem
        video={video}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={jest.fn()}
        onIgnore={jest.fn()}
      />
    );

    expect(screen.getByText('Cool Video')).toBeInTheDocument();
    expect(screen.getByText(/Channel One/)).toBeInTheDocument();
    expect(screen.getByText(/2:05/)).toBeInTheDocument();
  });

  test('omits the duration when missing', () => {
    render(
      <NewVideoQueueItem
        video={{ ...video, duration: null }}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={jest.fn()}
        onIgnore={jest.fn()}
      />
    );

    expect(screen.getByText('Channel One')).toBeInTheDocument();
  });

  test('calls onDownload when the download button is clicked', async () => {
    const user = userEvent.setup();
    const onDownload = jest.fn();
    render(
      <NewVideoQueueItem
        video={video}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={onDownload}
        onIgnore={jest.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Download Cool Video/i }));

    expect(onDownload).toHaveBeenCalledWith(video);
  });

  test('calls onIgnore when the ignore button is clicked', async () => {
    const user = userEvent.setup();
    const onIgnore = jest.fn();
    render(
      <NewVideoQueueItem
        video={video}
        selected={false}
        onToggleSelect={jest.fn()}
        onDownload={jest.fn()}
        onIgnore={onIgnore}
      />
    );

    await user.click(screen.getByRole('button', { name: /Ignore Cool Video/i }));

    expect(onIgnore).toHaveBeenCalledWith(video);
  });

  test('reflects the selected state on the checkbox', () => {
    render(
      <NewVideoQueueItem
        video={video}
        selected={true}
        onToggleSelect={jest.fn()}
        onDownload={jest.fn()}
        onIgnore={jest.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: /Select Cool Video/i })).toBeChecked();
  });

  test('calls onToggleSelect when the checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onToggleSelect = jest.fn();
    render(
      <NewVideoQueueItem
        video={video}
        selected={false}
        onToggleSelect={onToggleSelect}
        onDownload={jest.fn()}
        onIgnore={jest.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /Select Cool Video/i }));

    expect(onToggleSelect).toHaveBeenCalledWith(video);
  });
});
