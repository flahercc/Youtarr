import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import WebSocketContext from '../../contexts/WebSocketContext';
import { useVideoActivity } from '../../providers/VideoActivityProvider';
import { useLocalVideoStatus } from '../useLocalVideoStatus';

jest.mock('axios');
jest.mock('../../providers/VideoActivityProvider');
const post = axios.post as jest.Mock;
const activity = useVideoActivity as jest.Mock;
const id = 'aaaaaaaaaaa';

describe('useLocalVideoStatus', () => {
  let snapshot: { instanceId: string; revision: number; videos: {} };
  let subscriptions: Array<{ filter: (message: { type: string }) => boolean; callback: () => void }>;
  const subscribe = jest.fn();
  const unsubscribe = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WebSocketContext.Provider value={{ socket: null, subscribe, unsubscribe }}>{children}</WebSocketContext.Provider>
  );
  const emit = (type: string) => {
    subscriptions.forEach(sub => { if (sub.filter({ type })) sub.callback(); });
  };
  beforeEach(() => {
    jest.useFakeTimers();
    snapshot = { instanceId: 'server', revision: 1, videos: {} };
    subscriptions = [];
    activity.mockImplementation(() => ({ snapshot }));
    subscribe.mockImplementation((filter, callback) => subscriptions.push({ filter, callback }));
    post.mockResolvedValue({ data: { results: [] } });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('deduplicates IDs and batches requests at 500', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => String(i).padStart(11, '0'));
    renderHook(() => useLocalVideoStatus([...ids, ids[0]], 'token'), { wrapper });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][1].youtubeIds).toHaveLength(500);
    expect(post.mock.calls[1][1].youtubeIds).toEqual([ids[500]]);
  });

  it('ignores activity revisions and coalesces persisted and reconnect events', async () => {
    const { rerender } = renderHook(() => useLocalVideoStatus([id], 'token'), { wrapper });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    snapshot = { ...snapshot, revision: 2 };
    rerender();
    expect(post).toHaveBeenCalledTimes(1);
    act(() => { emit('videosUpdated'); emit('downloadComplete'); emit('connectionRestored'); });
    snapshot = { ...snapshot, instanceId: 'restarted', revision: 0 };
    rerender();
    await act(async () => { jest.advanceTimersByTime(150); });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('discards responses for an earlier ID set', async () => {
    let resolve!: (value: unknown) => void;
    post.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ ids }) => useLocalVideoStatus(ids, 'token'), {
      initialProps: { ids: [id] }, wrapper,
    });
    const newer = { youtubeId: 'bbbbbbbbbbb', status: 'downloaded' };
    post.mockResolvedValueOnce({ data: { results: [newer] } });
    rerender({ ids: [newer.youtubeId] });
    await waitFor(() => expect(result.current[newer.youtubeId]).toEqual(newer));
    await act(async () => { resolve({ data: { results: [{ youtubeId: id, status: 'missing' }] } }); });
    expect(result.current).toEqual({ [newer.youtubeId]: newer });
  });

  it('retains known metadata on failure and cancels pending refresh on unmount', async () => {
    const status = { youtubeId: id, status: 'downloaded' };
    post.mockResolvedValueOnce({ data: { results: [status] } });
    const { result, unmount } = renderHook(() => useLocalVideoStatus([id], 'token'), { wrapper });
    await waitFor(() => expect(result.current[id]).toEqual(status));
    post.mockRejectedValueOnce(new Error('offline'));
    act(() => emit('videosUpdated'));
    await act(async () => { jest.advanceTimersByTime(150); });
    expect(result.current[id]).toEqual(status);
    act(() => emit('videosUpdated'));
    unmount();
    await act(async () => { jest.advanceTimersByTime(150); });
    expect(post).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not request metadata without authentication or IDs', async () => {
    renderHook(() => useLocalVideoStatus([id], null), { wrapper });
    renderHook(() => useLocalVideoStatus([], 'token'), { wrapper });
    expect(post).not.toHaveBeenCalled();
  });
});
